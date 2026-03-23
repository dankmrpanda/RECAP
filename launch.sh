#!/usr/bin/env bash
set -e

echo "Starting RECAP Demo..."
docker compose up -d --build

echo "Waiting for server to be ready..."
until curl -s -o /dev/null http://localhost:5000 2>/dev/null; do
    sleep 1
done

echo "Server is ready! Opening browser..."
# Cross-platform browser open
if command -v xdg-open &>/dev/null; then
    xdg-open http://localhost:5000
elif command -v open &>/dev/null; then
    open http://localhost:5000
elif command -v start &>/dev/null; then
    start http://localhost:5000
fi

echo ""
echo "Showing logs (Ctrl+C to stop logs, container keeps running):"
docker compose logs -f
