#!/usr/bin/env bash
set -euo pipefail

# 念のため HOME を固定（Dockerで環境がブレるのを防ぐ）
export HOME="${HOME:-/root}"
mkdir -p "$HOME/.codex"

# コンテナでは keyring が無いことが多いので file に固定（任意だが推奨）
cat > "$HOME/.codex/config.toml" << 'TOML'
cli_auth_credentials_store = "file"
TOML

# ★ ここが重要：ディレクトリ有無ではなく「資格情報の有無」で判定
if ! codex login status >/dev/null 2>&1; then
  echo "[codex] not logged in. running 'codex login'..."
  codex login --device-auth
  echo "[codex] login completed."
fi

exec /work/run.sh "$@"
