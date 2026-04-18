#!/bin/bash
# sync.sh — pull latest from GitHub and restart backend

set -e
cd "$(dirname "$0")"

echo "Pulling latest..."
git pull

echo "Installing dependencies..."
cd backend
if [ ! -d ".venv" ]; then
  python3.9 -m venv .venv
fi
.venv/bin/pip install -r requirements.txt -q

echo "Restarting backend..."
pkill -f "uvicorn main:app" 2>/dev/null || true
sleep 1
FASTEMBED_CACHE_PATH="$HOME/.cache/fastembed" \
nohup .venv/bin/uvicorn main:app --port 8765 >> /tmp/neuralvault.log 2>> /tmp/neuralvault.error.log &
echo "Backend started on http://localhost:8765"
