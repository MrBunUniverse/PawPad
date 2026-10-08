#!/bin/bash

# Source user's shell environment to discover custom Node.js installs
if [ -f "$HOME/.zshrc" ]; then
    source "$HOME/.zshrc" >/dev/null 2>&1 || true
fi

export PATH="$HOME/.local/bin:$HOME/.nvm/versions/node/$(ls $HOME/.nvm/versions/node 2>/dev/null | tail -n 1)/bin:$HOME/.fnm/current/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR/mac-receiver"

echo "==============================================================="
echo "       PawPad: PS4 controller overlay bridge                 "
echo "==============================================================="
echo ""

# Auto open dashboard in default browser
(sleep 1 && open "http://localhost:8080") &

# Start Node receiver
node server.js
