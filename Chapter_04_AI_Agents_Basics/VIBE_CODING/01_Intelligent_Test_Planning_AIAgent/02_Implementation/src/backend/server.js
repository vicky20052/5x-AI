const fs = require("fs");
const path = require("path");
const express = require("express");

function loadEnvironment() {
  let directory = __dirname;
  while (true) {
    const candidate = path.join(directory, ".env");
    if (fs.existsSync(candidate)) {
      require("dotenv").config({ path: candidate });
      return;
    }
    const parent = path.dirname(directory);
    if (parent === directory) return;
    directory = parent;
  }
}

loadEnvironment();

const app = express();
app.use((request, response, next) => {
  if (!request.path.startsWith("/api/")) request.url = `/api${request.url}`;
  next();
});
app.use(express.json({ limit: "100kb" }));

const CONFIG_NAMES = ["JIRA_BASE_URL", "JIRA_EMAIL", "JIRA_TOKEN", "GROQ_API_KEY", "GROQ_MODEL"];

// Credentials entered by the visitor (per request, never stored) take priority;
// server-side environment variables are only a fallback.
function getConfig(request) {
  const supplied = (request.body && request.body.config) || {};
  const config = {};
  for (const name of CONFIG_NAMES) {
    const value = typeof supplied[name] === "string" ? supplied[name].trim() : "";
    config[name] = value || process.env[name] || "";
  }
  return config;
}

function requireConfig(config, required) {
  const missing = required.filter((name) => !config[name]);
  if (missing.length) {
    return { ok: false, error: `Missing configuration: ${missing.join(", ")}. Enter it in Settings.` };
  }
  if (required.includes("JIRA_BASE_URL")) {
    let url;
    try {
      url = new URL(config.JIRA_BASE_URL);
    } catch (error) {
      return { ok: false, error: "JIRA_BASE_URL must be a valid URL such as https://your-site.atlassian.net." };
    }
    const host = url.hostname.toLowerCase();
    const privateHost = host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") ||
      /^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host.includes(":") || host.startsWith("[");
    if (url.protocol !== "https:" || privateHost) {
      return { ok: false, error: "JIRA_BASE_URL must be a public https URL (no IP addresses or localhost)." };
    }
  }
  return { ok: true };
}

function jiraAuth(config) {
  return { Authorization: `Basic ${Buffer.from(`${config.JIRA_EMAIL}:${config.JIRA_TOKEN}`).toString("base64")}`, Accept: "application/json" };
}

app.post("/api/test/jira", async (request, response) => {
  const config = getConfig(request);
  const configCheck = requireConfig(config, ["JIRA_BASE_URL", "JIRA_EMAIL", "JIRA_TOKEN"]);
  if (!configCheck.ok) return response.status(400).json({ error: configCheck.error });

  try {
    const result = await fetch(`${config.JIRA_BASE_URL.replace(/\/$/, "")}/rest/api/3/myself`, {
      headers: jiraAuth(config), redirect: "error"
    });
    if (!result.ok) {
      return response.status(result.status).json({ error: `Jira connection failed (${result.status}).` });
    }
    response.json({ message: "Jira connection successful." });
  } catch (error) {
    response.status(503).json({ error: "Jira connection failed: network unavailable." });
  }
});

app.post("/api/test/groq", async (request, response) => {
  const config = getConfig(request);
  const configCheck = requireConfig(config, ["GROQ_API_KEY"]);
  if (!configCheck.ok) return response.status(400).json({ error: configCheck.error });
  try {
    const result = await fetch("https://api.groq.com/openai/v1/models", {
      headers: { Authorization: `Bearer ${config.GROQ_API_KEY}` }
    });
    if (!result.ok) return response.status(result.status).json({ error: `Groq connection failed (${result.status}).` });
    response.json({ message: "Groq connection successful." });
  } catch (error) {
    response.status(503).json({ error: "Groq connection failed: network unavailable." });
  }
});

app.post("/api/test-plan", async (request, response) => {
  const issueKey = String(request.body.issueKey || "").trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9]+-[1-9][0-9]*$/.test(issueKey)) {
    return response.status(400).json({ error: "Enter a valid Jira issue ID, for example QA-123." });
  }

  const config = getConfig(request);
  const configCheck = requireConfig(config, request.body.provider === "ollama" ? ["JIRA_BASE_URL", "JIRA_EMAIL", "JIRA_TOKEN"] : CONFIG_NAMES);
  if (!configCheck.ok) return response.status(400).json({ error: configCheck.error });

  let jiraResult;
  try {
    jiraResult = await fetch(
      `${config.JIRA_BASE_URL.replace(/\/$/, "")}/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=summary,description,acceptanceCriteria,issuetype,status,priority,labels,components`,
      { headers: jiraAuth(config), redirect: "error" }
    );
  } catch (error) {
    return response.status(503).json({ error: "Jira is unavailable due to a network failure." });
  }

  if (jiraResult.status === 404) return response.status(404).json({ error: "Jira issue was not found or is inaccessible." });
  if (jiraResult.status === 401 || jiraResult.status === 403) return response.status(jiraResult.status).json({ error: "Jira authentication or permission failed." });
  if (!jiraResult.ok) return response.status(502).json({ error: `Jira retrieval failed (${jiraResult.status}).` });

  const issue = await jiraResult.json();
  const fields = issue.fields || {};
  const prompt = `Use only the supplied Jira data. Use the exact test-plan template and section names below. Mark unsupported details exactly as "Insufficient information to determine." Proposed testing activities must be labeled as proposals. Jira key: ${issueKey}. Title: ${fields.summary || "Insufficient information to determine."}. Description: ${JSON.stringify(fields.description || null)}. Acceptance Criteria: ${JSON.stringify(fields.acceptanceCriteria || null)}. Metadata: ${JSON.stringify({ issuetype: fields.issuetype, status: fields.status, priority: fields.priority, labels: fields.labels, components: fields.components })}.

Template:
# Test Plan — ${issueKey}: ${fields.summary || "Insufficient information to determine."}
> Status: **DRAFT — pending human review.** Not approved until a QA owner signs off.
## 1. Scope & Objectives
- **In scope:**
- **Out of scope:**
- **Objective:** what "tested" means for this ticket.
## 2. Gaps & Questions for the author
| # | Area | Finding (⚠️/❌) | Question to author |
|---|------|----------------|--------------------|
| 1 |      |                |                    |
## 3. Test Scenarios
| ID | Priority | Type (pos/neg/boundary) | Scenario | Maps to (AC / gap) |
|----|----------|-------------------------|----------|--------------------|
| TS-1 | P0 |                       |          |                    |
## 4. Test Data & Environment
- **Data:**
- **Environment / flags:**
- **Roles / permissions:**
## 5. Risks & Assumptions
- **Assumptions made:**
- **Risks:**
## 6. Entry / Exit criteria
- **Entry:**
- **Exit:**
## 7. Resource Allocation
## 8. Timelines, Sprint Details
---
## HUMAN REVIEW GATE
- **I assumed:** …
- **I could not confirm:** …
- **Open questions blocking sign-off:** …
- **Approve, or edit, before I write test cases / automation.**`;

  // Ollama runs on the visitor's machine, so the browser calls it; the server only builds the prompt from Jira.
  if (request.body.provider === "ollama") {
    return response.json({ issueKey, prompt, system: "You generate accurate QA test plans. Never invent product details." });
  }

  let groqResult;
  try {
    groqResult = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.GROQ_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.GROQ_MODEL,
        temperature: 0,
        messages: [
          { role: "system", content: "You generate accurate QA test plans. Never invent product details." },
          { role: "user", content: prompt }
        ]
      })
    });
  } catch (error) {
    return response.status(503).json({ error: "Groq is unavailable due to a network failure." });
  }

  if (!groqResult.ok) return response.status(502).json({ error: `Test plan generation failed (${groqResult.status}).` });
  const generated = await groqResult.json();
  const testPlan = generated.choices?.[0]?.message?.content;
  if (!testPlan) return response.status(502).json({ error: "Test plan generation returned no content." });

  response.json({ issueKey, testPlan });
});

const port = Number(process.env.PORT || 3001);
if (require.main === module) {
  app.listen(port, "127.0.0.1", () => {
    console.log(`Backend listening on http://127.0.0.1:${port}`);
  });
}

module.exports = app;
