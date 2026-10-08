#!/bin/bash
echo "Stopping PS4 Controller Overlay Bridge..."
lsof -ti :8080 -ti :9999 | xargs kill -9 2>/dev/null || true
echo "✓ Bridge server stopped successfully."
sleep 1
