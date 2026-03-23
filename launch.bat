@echo off
echo Starting RECAP Demo...
docker compose up -d --build
echo Waiting for server to be ready...
:loop
curl -s -o nul http://localhost:5000 >nul 2>&1
if errorlevel 1 (
    timeout /t 1 /nobreak >nul
    goto loop
)
echo Server is ready! Opening browser...
start http://localhost:5000
echo.
echo Showing logs (Ctrl+C to stop logs, container keeps running):
docker compose logs -f
