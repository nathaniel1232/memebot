#!/bin/zsh
set -e
cd "${0:A:h}"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20 or newer is required. Install it, then double-click this file again."
  read "?Press Return to close..."
  exit 1
fi

if [[ ! -f .env ]]; then
  node src/setup.js
fi

(sleep 1; open "http://127.0.0.1:8787") &
echo "Launch Guard is starting in safe dry-run mode. Keep this window open."
echo "Press Control-C to stop it."
node src/bootstrap.js
