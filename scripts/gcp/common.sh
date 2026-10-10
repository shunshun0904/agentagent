#!/usr/bin/env bash
# scripts/gcp/*.sh の共通設定と関数。直接は実行しない。
# ここで定義する変数(REPO_ROOT、RUNTIME_SA など)は、このファイルを source するスクリプトが使う。
# shellcheck disable=SC2034

# ---- 設定(環境変数で上書きできる) ----
PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || true)}"
REGION="${REGION:-asia-northeast1}"
SERVICE="${SERVICE:-agentagent}"
SECRET_PREFIX="${SECRET_PREFIX:-${SERVICE}}"
RUNTIME_SA_NAME="${RUNTIME_SA_NAME:-${SERVICE}-run}"
JOB_NAME="${JOB_NAME:-${SERVICE}-tick}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# アプリの環境変数名 → Secret Manager のシークレット名
secret_id_for() {
  case "$1" in
    DATABASE_URL) echo "${SECRET_PREFIX}-database-url" ;;
    DIRECT_URL) echo "${SECRET_PREFIX}-direct-url" ;;
    GOOGLE_CLIENT_SECRET) echo "${SECRET_PREFIX}-google-client-secret" ;;
    ANTHROPIC_API_KEY) echo "${SECRET_PREFIX}-anthropic-api-key" ;;
    APP_ENCRYPTION_KEY) echo "${SECRET_PREFIX}-app-encryption-key" ;;
    CRON_SECRET) echo "${SECRET_PREFIX}-cron-secret" ;;
    DATABASE_CA_CERT) echo "${SECRET_PREFIX}-database-ca-cert" ;;
    *) return 1 ;;
  esac
}

info() { printf '\033[1;34m%s\033[0m\n' "$*"; }
ok() { printf '\033[1;32m%s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[注意] %s\033[0m\n' "$*" >&2; }
die() {
  printf '\033[1;31m[エラー] %s\033[0m\n' "$*" >&2
  exit 1
}

require_project() {
  [[ -n "${PROJECT_ID}" ]] || die "Google Cloud のプロジェクトが選ばれていません。'gcloud config set project プロジェクトID' を実行するか、PROJECT_ID=... を付けて実行してください"
  PROJECT_NUMBER="$(gcloud projects describe "${PROJECT_ID}" --format='value(projectNumber)')" ||
    die "プロジェクト ${PROJECT_ID} の情報を取得できませんでした"
  RUNTIME_SA="${RUNTIME_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
  # Cloud Run の決定的 URL(デプロイ前から分かる): https://SERVICE-PROJECT_NUMBER.REGION.run.app
  DEFAULT_APP_URL="https://${SERVICE}-${PROJECT_NUMBER}.${REGION}.run.app"
}

# 既存の Cloud Run サービスの環境変数を1つ読む(無ければ空)
service_env() {
  local name="$1"
  gcloud run services describe "${SERVICE}" --region "${REGION}" --project "${PROJECT_ID}" --format=json 2>/dev/null |
    python3 -c '
import json, sys
name = sys.argv[1]
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)
for c in data.get("spec", {}).get("template", {}).get("spec", {}).get("containers", []):
    for e in c.get("env", []) or []:
        if e.get("name") == name and "value" in e:
            print(e["value"])
            sys.exit(0)
' "${name}" || true
}

# Cloud Run サービスに割り当てられている URL の一覧(1行に1つ)
service_urls() {
  gcloud run services describe "${SERVICE}" --region "${REGION}" --project "${PROJECT_ID}" --format=json 2>/dev/null |
    python3 -c '
import json, sys
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)
urls = []
raw = data.get("metadata", {}).get("annotations", {}).get("run.googleapis.com/urls")
if raw:
    try:
        urls.extend(json.loads(raw))
    except Exception:
        pass
status_url = data.get("status", {}).get("url")
if status_url:
    urls.append(status_url)
seen = set()
for u in urls:
    if u not in seen:
        seen.add(u)
        print(u)
' || true
}
