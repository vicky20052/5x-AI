import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const JIRA_FIELDS = [
  ["JIRA_TOKEN", "Token", "", true],
  ["JIRA_EMAIL", "Email", "you@example.com", false],
  ["JIRA_BASE_URL", "Site URL", "https://your-site.atlassian.net", false]
];
const ALL_NAMES = [
  "JIRA_TOKEN", "JIRA_EMAIL", "JIRA_BASE_URL", "GROQ_API_KEY", "GROQ_MODEL", "OLLAMA_URL", "OLLAMA_MODEL"
];
const DEFAULTS = { LLM_PROVIDER: "groq", OLLAMA_URL: "http://localhost:11434" };
const OLLAMA_HINT = "Cannot reach Ollama. Is it running, with OLLAMA_ORIGINS allowing this site?";

function loadConfig() {
  try {
    return { ...DEFAULTS, ...JSON.parse(sessionStorage.getItem("tp-config") || "{}") };
  } catch (error) {
    return { ...DEFAULTS };
  }
}

function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return out;
}

function App() {
  const [config, setConfig] = useState(loadConfig);
  const [page, setPage] = useState("main");
  const [issueKey, setIssueKey] = useState("");
  const [result, setResult] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const ollama = config.LLM_PROVIDER === "ollama";
  const ollamaUrl = (config.OLLAMA_URL || DEFAULTS.OLLAMA_URL).replace(/\/$/, "");

  function updateConfig(next) {
    setConfig(next);
    try { sessionStorage.setItem("tp-config", JSON.stringify(next)); } catch (error) { /* ignore */ }
  }
  const field = (name) => ({
    value: config[name] || "",
    onChange: (event) => updateConfig({ ...config, [name]: event.target.value })
  });

  async function importEnv(event) {
    const file = event.target.files[0];
    if (!file) return;
    const parsed = parseEnv(await file.text());
    const next = { ...config };
    for (const name of ALL_NAMES) if (parsed[name]) next[name] = parsed[name];
    updateConfig(next);
    setStatus("Imported values from .env file (kept only in this browser tab).");
    event.target.value = "";
  }

  async function post(path, body) {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Request failed.");
    return data;
  }

  async function generatePlan(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setStatus("Generating...");
    setResult("");
    try {
      const data = await post("/api/test-plan", { issueKey, config, provider: ollama ? "ollama" : "groq" });
      if (!ollama) {
        setResult(data.testPlan);
      } else {
        const res = await fetch(`${ollamaUrl}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: config.OLLAMA_MODEL,
            stream: false,
            options: { temperature: 0 },
            messages: [{ role: "system", content: data.system }, { role: "user", content: data.prompt }]
          })
        }).catch(() => { throw new Error(OLLAMA_HINT); });
        if (!res.ok) throw new Error(`Ollama request failed (${res.status}).`);
        const out = await res.json();
        if (!out.message?.content) throw new Error("Ollama returned no content.");
        setResult(out.message.content);
      }
      setStatus("");
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function testConnection(type) {
    setStatus(`Testing ${type} connection...`);
    try {
      if (type === "ollama") {
        const res = await fetch(`${ollamaUrl}/api/tags`).catch(() => { throw new Error(OLLAMA_HINT); });
        if (!res.ok) throw new Error(`Ollama connection failed (${res.status}).`);
        setStatus("Ollama connection successful.");
      } else {
        const data = await post(`/api/test/${type}`, { config });
        setStatus(data.message);
      }
    } catch (error) {
      setStatus(error.message);
    }
  }

  return (
    <main>
      <nav>
        <button className={page === "main" ? "active" : ""} onClick={() => { setPage("main"); setStatus(""); }}>
          Main Page
        </button>
        <button className={page === "settings" ? "active" : ""} onClick={() => { setPage("settings"); setStatus(""); }}>
          Settings
        </button>
      </nav>

      {page === "main" ? (
        <section className="main-layout">
          <article className="panel result-panel">
            <h2>{result ? "Test Plan" : "Reply with Test Plan"}</h2>
            {result ? <pre>{result}</pre> : <p className="placeholder">{status || "Enter a Jira issue ID below."}</p>}
          </article>
          <form className="panel prompt-panel" onSubmit={generatePlan}>
            <label htmlFor="issueKey">PROMPT (JIRA TICKET)</label>
            <div className="prompt-row">
              <input
                id="issueKey"
                value={issueKey}
                onChange={(event) => setIssueKey(event.target.value)}
                placeholder="QA-123"
                disabled={busy}
              />
              <button type="submit" disabled={busy}>Generate Test Plan</button>
            </div>
            {status && result && <p className="error">{status}</p>}
          </form>
        </section>
      ) : (
        <section className="settings-layout">
          <h2 className="settings-title">Settings</h2>
          <label className="env-import">Load .env file <input type="file" accept=".env,text/plain" onChange={importEnv} /></label>
          <article className="settings-card">
            <h3>Jira connection</h3>
            {JIRA_FIELDS.map(([name, label, placeholder, secret]) => (
              <label key={name}>{label}
                <input type={secret ? "password" : "text"} autoComplete="off" placeholder={placeholder} {...field(name)} />
              </label>
            ))}
            <button onClick={() => testConnection("jira")}>Test Connection</button>
          </article>
          <article className="settings-card">
            <h3>LLM Configuration</h3>
            <label className="radio">
              <input type="radio" name="provider" checked={ollama}
                onChange={() => updateConfig({ ...config, LLM_PROVIDER: "ollama" })} /> 1. Ollama Connection
            </label>
            {ollama && (
              <>
                <label>Ollama URL <input autoComplete="off" {...field("OLLAMA_URL")} /></label>
                <label>Model <input autoComplete="off" placeholder="llama3.1" {...field("OLLAMA_MODEL")} /></label>
              </>
            )}
            <label className="radio">
              <input type="radio" name="provider" checked={!ollama}
                onChange={() => updateConfig({ ...config, LLM_PROVIDER: "groq" })} /> 2. Groq.com (API Key)
            </label>
            {!ollama && (
              <>
                <label>API Key <input type="password" autoComplete="off" {...field("GROQ_API_KEY")} /></label>
                <label>Model <input autoComplete="off" placeholder="openai/gpt-oss-120b" {...field("GROQ_MODEL")} /></label>
              </>
            )}
            <button onClick={() => testConnection(ollama ? "ollama" : "groq")}>
              {ollama ? "Test local LLM" : "Test Groq.com"}
            </button>
          </article>
          {status && <p className="settings-status">{status}</p>}
        </section>
      )}
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
