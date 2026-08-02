#!/usr/bin/env bash
set -euo pipefail
ROOT=$(git rev-parse --show-toplevel)
WT="$ROOT/../.release-deploy"

echo ">> Build frontend"
cd "$ROOT/frontend" && npm ci && npm run build

echo ">> Quét secret"
gitleaks detect -s "$ROOT" --no-banner

echo ">> Đóng gói sang nhánh deploy"
git -C "$ROOT" worktree add -f "$WT" deploy 2>/dev/null || true
rsync -a --delete --exclude '.git' --exclude 'node_modules' --exclude '.DS_Store' \
      "$ROOT/backend/" "$WT/"

cd "$WT"
git add -A
git commit -m "release: $(date '+%Y-%m-%d %H:%M') từ $(git -C "$ROOT" rev-parse --short HEAD)" || {
  echo "Không có thay đổi"; exit 0; }
git push origin deploy
echo "Xong. Vào Plesk bấm Pull Updates."
