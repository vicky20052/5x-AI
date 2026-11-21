# Jira Test Plan Generator

Small React and Express app for generating a test plan from a Jira issue.

## Prerequisites
- Node.js 18+
- Existing Jira connection values and Groq API key in the repository parent `.env`
- Add `GROQ_MODEL` to the `.env` with an enabled Groq chat model name

The backend reads `.env` automatically from the nearest parent directory. It never sends secrets to the browser.

Required environment names:
- `JIRA_BASE_URL`
- `JIRA_EMAIL`
- `JIRA_TOKEN`
- `GROQ_API_KEY`
- `GROQ_MODEL`

## Run
```powers
npm install
npm run dev
```
Open `http://127.0.0.1:5173`.

## Use
1. Enter a Jira issue ID such as `QA-123`.
2. Generate the test plan.
3. Open Settings to test Jira or Groq connectivity.

## Deploy to Vercel
1. Set the Vercel project root directory to this `02_Implementation` folder.
2. Add `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_TOKEN`, `GROQ_API_KEY`, and `GROQ_MODEL` as server-side environment variables in the Vercel project settings. Add them for the Production environment and redeploy.
3. Assign `ai5x-testplanagent.vercel.app` to the project in Vercel's Domains settings, if that domain is available to your Vercel account.

Credentials are entered by each visitor in the Settings page (or loaded from their own .env file). They stay in the browser tab and are sent per request, never stored. Server-side env vars are an optional fallback. Do not commit `.env`.

## Verify
- Frontend build: `npm run build`
- Invalid Jira IDs are rejected before Jira or AI calls.
- The frontend and backend servers were started successfully.
- Jira and Groq connection endpoints passed live credential checks.
- Live integration requires the configured credentials and model to remain valid.
