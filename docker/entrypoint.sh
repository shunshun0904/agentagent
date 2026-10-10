#!/bin/sh
# コンテナの起動処理(Cloud Run 用)
# 1. データベースのマイグレーションを適用する(RUN_MIGRATIONS_ON_START=false で無効化できる)
# 2. Next.js サーバーを起動する(PORT は Cloud Run が設定する)
set -e

# どのネットワークインターフェースでも待ち受ける(実行環境が HOSTNAME を設定していても上書きする)
export HOSTNAME=0.0.0.0

# パスワードを含めずに接続先を表示する
describe_url() {
  node -e '
    try {
      const u = new URL(process.argv[1]);
      console.log(`${decodeURIComponent(u.username)}@${u.hostname}:${u.port || "5432"}${u.pathname}`);
    } catch {
      console.log("(接続文字列を解析できません。パスワードの記号や [ ] を確認してください)");
    }' "$1"
}

if [ "${RUN_MIGRATIONS_ON_START:-true}" = "true" ]; then
  target="${DIRECT_URL:-${DATABASE_URL:-}}"
  if [ -z "${target}" ]; then
    echo "[entrypoint] エラー: DIRECT_URL と DATABASE_URL が設定されていません" >&2
    exit 1
  fi
  echo "[entrypoint] データベースのマイグレーションを適用します。接続先: $(describe_url "${target}")"
  if ! (cd /app/migrate && node node_modules/prisma/build/index.js migrate deploy); then
    cat >&2 <<'HINT'
[entrypoint] エラー: データベースのマイグレーションに失敗したため、サーバーを起動しません。
[entrypoint] よくある原因:
[entrypoint]   - 接続先が db.xxxx.supabase.co: IPv6 専用の直接接続です。Session pooler(pooler.supabase.com、ポート 5432)を使ってください
[entrypoint]   - password authentication failed: パスワードが違います
[entrypoint]   - Tenant or user not found: ユーザー名が postgres.<プロジェクトID> になっていません
[entrypoint]   - 接続文字列を解析できない: パスワードの前後の [ ] や、エンコードされていない記号を確認してください
[entrypoint] 直し方: Cloud Shell で bash scripts/gcp/setup.sh を再実行すると、接続を確認して入力し直せます
HINT
    exit 1
  fi
fi

echo "[entrypoint] サーバーを起動します(ポート ${PORT:-8080})"
exec node /app/server.js
