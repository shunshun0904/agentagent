#!/bin/sh
# コンテナの起動処理(Cloud Run 用)
# 1. データベースのマイグレーションを適用する(RUN_MIGRATIONS_ON_START=false で無効化できる)
# 2. Next.js サーバーを起動する(PORT は Cloud Run が設定する)
set -e

if [ "${RUN_MIGRATIONS_ON_START:-true}" = "true" ]; then
  echo "[entrypoint] データベースのマイグレーションを適用します"
  (cd /app/migrate && node node_modules/prisma/build/index.js migrate deploy)
fi

echo "[entrypoint] サーバーを起動します(ポート ${PORT:-8080})"
exec node /app/server.js
