#!/usr/bin/env bash
#
# エージェントエージェント: 再デプロイ(コードを更新したとき)
#   bash scripts/gcp/deploy.sh
# 環境変数・シークレット・サービスアカウントの設定は前回のものを引き継ぐ。
# 初回は scripts/gcp/setup.sh を実行すること。
#
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
require_project

gcloud run services describe "${SERVICE}" --region "${REGION}" --project "${PROJECT_ID}" >/dev/null 2>&1 ||
  die "サービス ${SERVICE} がありません。先に bash scripts/gcp/setup.sh を実行してください"

info "Cloud Run に再デプロイしています: ${SERVICE}(${REGION})"
gcloud run deploy "${SERVICE}" --source "${REPO_ROOT}" --region "${REGION}" --project "${PROJECT_ID}" --quiet
ok "再デプロイが完了しました"
