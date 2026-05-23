# 🔬 Ageing Monitor

Lab tool for tracking material degradation experiments. Start a timed test, get notified when it completes, attach photos/notes, export CSV.

## Quick Start

### Mac / Linux
```bash
./start.sh
```

### Windows
Double-click **`start.bat`**

That's it. The script installs everything and opens the app.

---

## What it opens

| | URL |
|---|---|
| **App** | http://localhost:8081 |
| **API** | http://localhost:8000/api/ |
| **API docs** (Swagger) | http://localhost:8000/docs |

---

## Requirements

| Tool | Min version | Download |
|---|---|---|
| Python | 3.11 | https://python.org |
| Node.js | 20 | https://nodejs.org |

No MongoDB needed — uses an in-memory database for local dev.

---

## Mobile (iOS / Android)

1. Install **Expo Go** on your phone
2. Run `cd frontend && npx expo start`
3. Scan the QR code

---

## Deploy to production

See **`DEPLOYMENT_GUIDE.md`** for full cloud deployment instructions (Render + Expo EAS).

---

## Project layout

```
ageing-monitor/
├── start.sh              ← Mac/Linux launcher
├── start.bat             ← Windows launcher
├── backend/
│   ├── server_dev.py     ← FastAPI app (in-memory DB, for local dev)
│   ├── server.py         ← FastAPI app (real MongoDB, for production)
│   ├── email_service.py  ← Gmail completion alerts
│   └── requirements.txt
└── frontend/             ← React Native / Expo app
    ├── app/              ← Screens (tabs, experiment detail, new experiment)
    └── src/api/client.ts ← API client
```

## Environment variables (production only)

Copy `backend/.env.example` to `backend/.env` and fill in:

```
MONGO_URL=mongodb+srv://...
DB_NAME=ageing_monitor
GMAIL_USER=you@gmail.com           # optional
GMAIL_APP_PASSWORD=xxxx xxxx ...   # optional
NOTIFY_RECIPIENT_EMAIL=lab@org.com # optional
```
