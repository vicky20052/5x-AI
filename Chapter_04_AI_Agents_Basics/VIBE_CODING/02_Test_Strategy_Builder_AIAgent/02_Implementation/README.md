# Jira Test Strategy Builder

A lightweight React and Express app that drafts a Test Strategy from a Jira issue.

## Requirements
- Node.js 18+
- Parent `.env` configured with `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_TOKEN`, `GROQ_API_KEY`, and `GROQ_MODEL`

The backend finds and loads the parent `.env`. Credentials are never sent to the browser. The strategy is a Jira-ticket-level draft and should be reviewed with project-wide context before approval.

## Start
From this directory:

```powershell
npm install
npm run dev
```

Open http://127.0.0.1:5174.

## Use
Enter a Jira issue ID such as `QA-123` and select **Generate Test Strategy**. Use **Settings** to test Jira and Groq connectivity, including whether the configured Groq model is listed.

## Verification
Run `npm run build` to build the frontend. The backend validates issue keys, limits Jira description text sent to Groq, and reports missing configuration and provider errors. Live generation requires valid Jira permissions, network access, and an available Groq model.
