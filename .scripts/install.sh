#!/usr/bin/env bash

UUID="icon-matcher@peppodev"
EXT_DIR="$HOME/.local/share/gnome-shell/extensions/$UUID"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "Installing $UUID..."

mkdir -p "$EXT_DIR"
cp "$PROJECT_DIR/extension.js" "$EXT_DIR/"
cp "$PROJECT_DIR/metadata.json" "$EXT_DIR/"

echo "Files copied to $EXT_DIR"

echo "To watch logs:"
echo "journalctl -f /usr/bin/gnome-shell | grep '\[IconMatcher\]'"
