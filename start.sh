#!/usr/bin/env bash
# ─────────────────────────────────────────────
#  Ageing Monitor — one-command local launcher
# ─────────────────────────────────────────────
set -e

BACKEND_PORT=8000
FRONTEND_PORT=8081
ROOT="$(cd "$(dirname "$0")" && pwd)"

RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'
YELLOW='\033[1;33m'; BOLD='\033[1m'; NC='\033[0m'

log()  { echo -e "${CYAN}[ageing-monitor]${NC} $*"; }
ok()   { echo -e "${GREEN}✓${NC} $*"; }
warn() { echo -e "${YELLOW}⚠${NC}  $*"; }
die()  { echo -e "${RED}✗ $*${NC}"; exit 1; }

cleanup() {
  echo ""
  log "Shutting down..."
  [[ -n $BACKEND_PID  ]] && kill "$BACKEND_PID"  2>/dev/null && ok "Backend stopped"
  [[ -n $FRONTEND_PID ]] && kill "$FRONTEND_PID" 2>/dev/null && ok "Frontend stopped"
}
trap cleanup EXIT INT TERM

# ── 1. Check prerequisites ──────────────────────────────────────────────────
echo ""
echo -e "${BOLD}  🔬 Ageing Monitor — Local Dev Launcher${NC}"
echo "  ────────────────────────────────────────"
echo ""

command -v python3 >/dev/null || die "python3 not found. Install Python 3.11+."
command -v node    >/dev/null || die "node not found. Install Node.js 20+."
command -v npm     >/dev/null || die "npm not found."

PY_VER=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
log "Python $PY_VER detected"

NODE_VER=$(node --version)
log "Node $NODE_VER detected"

# ── 2. Backend setup ────────────────────────────────────────────────────────
log "Installing backend dependencies..."
cd "$ROOT/backend"
pip install fastapi uvicorn mongomock-motor python-dotenv pydantic \
    email-validator python-multipart --break-system-packages -q \
    || pip install fastapi uvicorn mongomock-motor python-dotenv pydantic \
       email-validator python-multipart -q
ok "Backend dependencies ready"

log "Starting backend on port $BACKEND_PORT..."
python3 -m uvicorn server_dev:app \
    --host 0.0.0.0 --port "$BACKEND_PORT" \
    --log-level warning > /tmp/ageing-backend.log 2>&1 &
BACKEND_PID=$!

# Wait for backend to be ready
for i in {1..15}; do
  if curl -sf "http://localhost:$BACKEND_PORT/api/" >/dev/null 2>&1; then
    ok "Backend is up (pid $BACKEND_PID)"
    break
  fi
  sleep 1
  [[ $i == 15 ]] && { cat /tmp/ageing-backend.log; die "Backend failed to start"; }
done

# ── 3. Frontend setup ───────────────────────────────────────────────────────
cd "$ROOT/frontend"

# Write env file
echo "EXPO_PUBLIC_BACKEND_URL=http://localhost:$BACKEND_PORT" > .env
ok ".env written (EXPO_PUBLIC_BACKEND_URL=http://localhost:$BACKEND_PORT)"

if [[ ! -d node_modules ]]; then
  log "Installing frontend dependencies (first run — takes ~1 min)..."
  npm install --legacy-peer-deps --silent
  ok "Frontend dependencies installed"
else
  ok "Frontend node_modules already present"
fi

log "Starting frontend on port $FRONTEND_PORT..."
EXPO_NO_DOTENV=0 npx expo start --web --port "$FRONTEND_PORT" \
    > /tmp/ageing-frontend.log 2>&1 &
FRONTEND_PID=$!

# Wait for frontend
for i in {1..30}; do
  if curl -sf "http://localhost:$FRONTEND_PORT/" >/dev/null 2>&1; then
    ok "Frontend is up (pid $FRONTEND_PID)"
    break
  fi
  sleep 1
  [[ $i == 30 ]] && warn "Frontend taking longer than expected — check /tmp/ageing-frontend.log"
done

# ── 4. Summary ──────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}  ✅ Ageing Monitor is running!${NC}"
echo "  ──────────────────────────────────────────────"
echo -e "  ${GREEN}Frontend${NC}  →  http://localhost:$FRONTEND_PORT"
echo -e "  ${GREEN}API${NC}       →  http://localhost:$BACKEND_PORT/api/"
echo -e "  ${GREEN}API docs${NC}  →  http://localhost:$BACKEND_PORT/docs"
echo ""
echo -e "  ${YELLOW}Press Ctrl+C to stop both servers${NC}"
echo ""

# Keep script alive
wait $BACKEND_PID $FRONTEND_PID
