#!/usr/bin/env bash
set -e

echo "=== Neural Vault Assistant Setup ==="

# ── Backend ──────────────────────────────────────────────────────────
echo ""
echo "1. Setting up Python backend..."
cd backend

python3 -m venv .venv
source .venv/bin/activate

pip install --upgrade pip -q
pip install -r requirements.txt -q

# Create .env if it doesn't exist
if [ ! -f .env ]; then
  cp .env.example .env
  echo ""
  echo "   Created backend/.env — EDIT IT and add your ANTHROPIC_API_KEY and VAULT_PATH."
fi

deactivate
cd ..

# ── Plugin ───────────────────────────────────────────────────────────
echo ""
echo "2. Setting up Obsidian plugin..."
cd plugin

if command -v npm &>/dev/null; then
  npm install -q
  npm run build
  echo "   Plugin built → plugin/main.js"
else
  echo "   npm not found — install Node.js then run 'cd plugin && npm install && npm run build'"
fi

cd ..

echo ""
echo "=== Setup complete ==="
echo ""
echo "Next steps:"
echo "  1. Edit backend/.env — set ANTHROPIC_API_KEY and VAULT_PATH"
echo "  2. Start the backend:"
echo "       cd backend && source .venv/bin/activate && uvicorn main:app --port 8765"
echo ""
echo "  3. Install the plugin in Obsidian:"
echo "       - Go to Settings → Community plugins → Load unplugged plugin"
echo "       - Or copy plugin/main.js + plugin/manifest.json to:"
echo "           <your-vault>/.obsidian/plugins/neural-vault-assistant/"
echo ""
echo "  4. Open Obsidian → click the brain icon in the ribbon → start chatting!"
