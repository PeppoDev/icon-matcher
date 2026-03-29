#!/usr/bin/env bash
set -euo pipefail

UUID="icon-matcher@gnome-extension"
EXT_DIR="$HOME/.local/share/gnome-shell/extensions/$UUID"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Installing $UUID..."

mkdir -p "$EXT_DIR"
cp "$SCRIPT_DIR/extension.js" "$EXT_DIR/"
cp "$SCRIPT_DIR/metadata.json" "$EXT_DIR/"

echo "Files copied to $EXT_DIR"

# Enable the extension (safe to run even if already enabled)
gnome-extensions enable "$UUID" 2>/dev/null && echo "Extension enabled." || true

echo ""
echo "Done. To reload after code changes:"
echo "  gnome-extensions disable $UUID && gnome-extensions enable $UUID"
echo ""
echo "To watch logs:"
echo "  journalctl -f /usr/bin/gnome-shell | grep '\[IconMatcher\]'"
