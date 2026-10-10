#!/usr/bin/env bash
#
# エージェントエージェント: シークレットの値を変更し、Cloud Run に反映する
#   bash scripts/gcp/set-secret.sh ANTHROPIC_API_KEY
# 対象: DATABASE_URL / DIRECT_URL / GOOGLE_CLIENT_SECRET / ANTHROPIC_API_KEY / CRON_SECRET / DATABASE_CA_CERT
#
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
require_project

name="${1:-}"
[[ -n "${name}" ]] || die "使い方: bash scripts/gcp/set-secret.sh 環境変数名(例: ANTHROPIC_API_KEY)"
if [[ "${name}" == "APP_ENCRYPTION_KEY" && "${2:-}" != "--force" ]]; then
  die "APP_ENCRYPTION_KEY を変えると保存済みの Gmail トークンを復号できなくなり、再ログインが必要になります。理解した上で変更する場合は --force を付けてください"
fi
secret_id="$(secret_id_for "${name}")" || die "未対応の名前です: ${name}"
gcloud secrets describe "${secret_id}" --project "${PROJECT_ID}" >/dev/null 2>&1 ||
  die "シークレット ${secret_id} がありません。先に bash scripts/gcp/setup.sh を実行してください"

read -r -s -p "${name} の新しい値: " value
echo
[[ -n "${value}" ]] || die "値が空です"
if [[ "${name}" == "DIRECT_URL" && "${value}" != *"sslmode="* ]]; then
  if [[ "${value}" == *"?"* ]]; then value="${value}&sslmode=require"; else value="${value}?sslmode=require"; fi
fi
printf '%s' "${value}" | gcloud secrets versions add "${secret_id}" --data-file=- --project "${PROJECT_ID}" --quiet >/dev/null
ok "${secret_id} を更新しました"

# 新しいリビジョンを作り、最新のシークレットを読み込ませる
gcloud run services update "${SERVICE}" --region "${REGION}" --project "${PROJECT_ID}" \
  --update-labels "secret-updated-at=$(date +%Y%m%d%H%M%S)" --quiet >/dev/null
ok "Cloud Run に反映しました"

if [[ "${name}" == "CRON_SECRET" ]]; then
  warn "CRON_SECRET を変えた場合は、Cloud Scheduler の設定も更新するため bash scripts/gcp/setup.sh を再実行してください"
fi
