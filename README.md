# Pocket Archive

A self-hosted archive for [Hey Pocket](https://heypocket.com) voice recordings — with AI-generated notes, audio playback, and a clean web UI.

## Structure

```
pocket-archive-monorepo/
├── frontend/   React + Vite + Tailwind web app
├── backend/    Node.js / Express API server
└── sync/       Python script that pulls recordings from Hey Pocket
```

## Quick Start

### 1. Sync script
```bash
cd sync
cp .env.example .env   # fill in POCKET_API_KEY and CLAUDE_API_KEY
pip install -r requirements.txt
python pocket_sync.py
```

### 2. Backend
```bash
cd backend
cp .env.example .env   # fill in ARCHIVE_PATH and CLAUDE_API_KEY
npm install
node setup-password.js  # set your login password
node server.js
```

### 3. Frontend (dev)
```bash
cd frontend
npm install
npm run dev   # opens http://localhost:5173
```

### Docker (backend + frontend build)
```bash
cd backend
cp .env.example .env
docker compose up -d
```

## Environment Variables

See `.env.example` in each subdirectory for required variables.

**backend/.env**
- `ARCHIVE_PATH` — absolute path to the archive folder populated by `sync/pocket_sync.py`
- `CLAUDE_API_KEY` — Anthropic API key (for AI note regeneration via the UI)
- `JWT_SECRET` — random secret for session tokens

**sync/.env**
- `POCKET_API_KEY` — Hey Pocket API key (starts with `pk_`)
- `CLAUDE_API_KEY` — Anthropic API key (starts with `sk-ant-`)
- `ARCHIVE_PATH` — where to write archive folders
