# Tender Insight

Tender Insight is an MVP for screening engineering tender notices against a company's qualifications, personnel, project history, and bidding preferences.

Current scope:

- Nanjing construction tender notices first.
- Manual company capability data entry first.
- Deterministic rule matching before AI.
- Linux-friendly backend runtime using `HOST`, `PORT`, and environment variables.

## Local Development

```bash
npm install
npm run test
npm run typecheck
npm run build
```

Run the backend:

```bash
cp .env.example .env
npm run dev:backend
```

Run the frontend:

```bash
npm run dev:frontend
```

## Linux Deployment

The backend binds to `0.0.0.0` by default and exposes `/api/health`.

Docker Compose is the intended first deployment path on a Linux cloud server:

```bash
cp .env.example .env
docker compose up -d --build
```

The app writes runtime files under `DATA_DIR`. Logs are written to stdout/stderr for Docker, systemd, or cloud log collection.

## Remote Browser Crawler

Remote browser collection is optional. Configure these variables on the backend server to enable Browserbase-compatible collection:

- `BROWSERBASE_API_KEY`
- `BROWSERBASE_PROJECT_ID`
- `REMOTE_BROWSER_TIMEOUT_MS`

If these variables are missing, direct fetch crawlers continue to work and remote browser jobs fail with a structured diagnostic.
