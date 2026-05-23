@echo off
REM ─────────────────────────────────────────────
REM  Ageing Monitor — Windows local launcher
REM ─────────────────────────────────────────────
setlocal EnableDelayedExpansion

set BACKEND_PORT=8000
set FRONTEND_PORT=8081
set ROOT=%~dp0

echo.
echo   Ageing Monitor — Local Dev Launcher
echo   ─────────────────────────────────────
echo.

REM Check prerequisites
where python >nul 2>&1 || (echo ERROR: python not found. Install Python 3.11+ from python.org & pause & exit /b 1)
where node   >nul 2>&1 || (echo ERROR: node not found. Install Node.js 20+ from nodejs.org & pause & exit /b 1)
where npm    >nul 2>&1 || (echo ERROR: npm not found & pause & exit /b 1)

echo [OK] Prerequisites found

REM Backend dependencies
echo.
echo [1/4] Installing backend dependencies...
cd /d "%ROOT%backend"
pip install fastapi uvicorn mongomock-motor python-dotenv pydantic email-validator python-multipart --break-system-packages -q
echo [OK] Backend dependencies installed

REM Start backend
echo.
echo [2/4] Starting backend on port %BACKEND_PORT%...
start "Ageing-Backend" /min cmd /c "python -m uvicorn server_dev:app --host 0.0.0.0 --port %BACKEND_PORT%"
timeout /t 4 /nobreak >nul
echo [OK] Backend started

REM Frontend env
echo.
echo [3/4] Setting up frontend...
cd /d "%ROOT%frontend"
echo EXPO_PUBLIC_BACKEND_URL=http://localhost:%BACKEND_PORT%>.env

if not exist node_modules (
  echo Installing frontend dependencies - this takes ~1 minute...
  npm install --legacy-peer-deps --silent
)
echo [OK] Frontend ready

REM Start frontend
echo.
echo [4/4] Starting frontend on port %FRONTEND_PORT%...
start "Ageing-Frontend" /min cmd /c "npx expo start --web --port %FRONTEND_PORT%"
timeout /t 6 /nobreak >nul

echo.
echo   ========================================
echo     Ageing Monitor is running!
echo   ========================================
echo.
echo   Frontend  ^>  http://localhost:%FRONTEND_PORT%
echo   API       ^>  http://localhost:%BACKEND_PORT%/api/
echo   API docs  ^>  http://localhost:%BACKEND_PORT%/docs
echo.
echo   Close the two terminal windows to stop.
echo.

REM Open browser
start http://localhost:%FRONTEND_PORT%

pause
