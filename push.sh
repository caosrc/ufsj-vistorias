#!/bin/bash
# push.sh — Build, push para GitHub e deploy no Cloudflare
# Uso: bash push.sh "mensagem opcional"
set -e

if [ -z "$GITHUB_TOKEN" ]; then
  echo "GITHUB_TOKEN nao encontrado nos secrets."
  exit 1
fi

echo "==> Build do frontend..."
cd defesa-civil && npm run build --silent
cd ..

echo "==> Deploy para Cloudflare (geovistorias-api.rc26.workers.dev)..."
cd server && WRANGLER_CI=1 npx wrangler deploy --config wrangler.toml 2>&1 | grep -E "Uploaded|Deployed|https://|ERROR"
cd ..

echo ""
echo "==> Push para GitHub..."
git add -A

if git diff --cached --quiet; then
  echo "Nada novo para commitar."
else
  git commit -m "${1:-"chore: atualização via Replit"}"
fi

git --no-optional-locks push "https://x-access-token:${GITHUB_TOKEN}@github.com/caosrc/ufsj-vistorias.git" main

echo ""
echo "Concluido!"
echo "  App: https://geovistorias-api.rc26.workers.dev"
echo "  GitHub: https://github.com/caosrc/ufsj-vistorias"
