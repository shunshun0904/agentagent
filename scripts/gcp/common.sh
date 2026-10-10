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

# Cloud Run の最近のログを古い順に表示する
print_recent_logs() {
  local limit="${1:-80}"
  gcloud logging read \
    "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"${SERVICE}\"" \
    --project "${PROJECT_ID}" \
    --limit "${limit}" \
    --freshness "${LOG_FRESHNESS:-1d}" \
    --format 'value(timestamp.date("%Y-%m-%d %H:%M:%S"), resource.labels.revision_name, textPayload)' 2>/dev/null | tac || true
}

# 接続文字列を検査・正規化する(問題があれば理由を表示して失敗する)
normalize_db_url() {
  local kind="$1" value="$2"
  python3 "${REPO_ROOT}/scripts/gcp/dburl.py" normalize "${kind}" "${value}"
}

# 標準入力が端末か(対話入力できるか)
is_interactive() { [[ -t 0 ]]; }

# 画面に表示せずに値を入力させる(入力した値を標準出力に返す)
prompt_value() {
  local label="$1" value=""
  read -r -s -p "  ${label}: " value
  echo >&2
  printf '%s' "${value}"
}

read_secret() {
  gcloud secrets versions access latest --secret "$1" --project "${PROJECT_ID}" 2>/dev/null
}

# Secret Manager に新しいバージョンとして保存する(シークレットが無ければ作る)
write_secret() {
  local secret_id="$1" value="$2"
  if ! gcloud secrets describe "${secret_id}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
    gcloud secrets create "${secret_id}" --replication-policy automatic --project "${PROJECT_ID}" --quiet >/dev/null
  fi
  printf '%s' "${value}" | gcloud secrets versions add "${secret_id}" --data-file=- --project "${PROJECT_ID}" --quiet >/dev/null
}

# psql のエラー内容から原因の見当を表示する
explain_db_error() {
  local out="$1"
  case "${out}" in
    *"password authentication failed"*)
      warn "パスワードが違います。Supabase の「Reset database password」で設定したパスワードか確認してください" ;;
    *"Tenant or user not found"*)
      warn "ユーザー名またはプロジェクトが見つかりません。Supabase の「Connect」画面の文字列をそのまま使ってください" ;;
    *"could not translate host name"* | *"Name or service not known"*)
      warn "ホスト名が見つかりません。接続文字列のホスト名を確認してください" ;;
    *"Network is unreachable"* | *"timeout expired"* | *"timed out"* | *"Connection refused"*)
      warn "接続先に届きません。ホスト名とポート番号を確認してください" ;;
    *)
      warn "データベースに接続できませんでした" ;;
  esac
}

# Anthropic API キーから、貼り付けで混ざりやすい前後の空白と引用符を取り除く
normalize_anthropic_key() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  value="${value#\"}"
  value="${value%\"}"
  value="${value#\'}"
  value="${value%\'}"
  printf '%s' "${value}"
}

# Anthropic API キーが使えるかを、モデル一覧の取得で確かめる(トークンは消費しない)。
# 使えないと分かった場合だけ 1 を返す。通信できないなど確かめられない場合は 0(確認を省略)。
# 結果は標準エラーに出す(呼び出し元が標準出力を値として受け取ることがあるため)
check_anthropic_key() {
  local key="$1" status
  if ! command -v curl >/dev/null 2>&1; then
    warn "curl が見つからないため、ANTHROPIC_API_KEY の確認を省略します"
    return 0
  fi
  # キーがプロセス一覧に出ないよう、ヘッダーは標準入力から渡す
  status="$(printf 'x-api-key: %s\nanthropic-version: 2023-06-01\n' "${key}" |
    curl -sS -o /dev/null -w '%{http_code}' --max-time 20 -H @- https://api.anthropic.com/v1/models 2>/dev/null)" || status="000"
  case "${status}" in
    200)
      ok "  - ANTHROPIC_API_KEY: 使えるキーです" >&2
      return 0
      ;;
    401)
      warn "ANTHROPIC_API_KEY が無効です(401)。Claude Console(https://platform.claude.com)の Settings → API keys で作成したキー(sk-ant- で始まる)を入力してください。キーは作成時に一度しか表示されないため、分からない場合は新しく作成します"
      return 1
      ;;
    403)
      warn "ANTHROPIC_API_KEY に API を使う権限がありません(403)。Claude Console で組織とワークスペースの設定を確認してください"
      return 1
      ;;
    000)
      warn "Anthropic API に接続できなかったため、ANTHROPIC_API_KEY の確認を省略します"
      return 0
      ;;
    *)
      warn "ANTHROPIC_API_KEY の確認で想定外の応答がありました(HTTP ${status})。このまま進めます"
      return 0
      ;;
  esac
}

# 接続文字列で実際に接続できるか確認する(psql が無ければ確認を省略して成功扱い)
check_db_connection() {
  local name="$1" url="$2" out
  if [[ "${SKIP_DB_CHECK:-false}" == "true" ]]; then
    return 0
  fi
  if ! command -v psql >/dev/null 2>&1; then
    warn "psql が見つからないため、${name} の接続確認を省略します"
    return 0
  fi
  if out="$(PGCONNECT_TIMEOUT=15 psql "$(python3 "${REPO_ROOT}/scripts/gcp/dburl.py" libpq "${url}")" -X -tAc 'select 1' 2>&1)"; then
    ok "  - ${name}: 接続できました($(python3 "${REPO_ROOT}/scripts/gcp/dburl.py" describe "${url}"))"
    return 0
  fi
  printf '%s\n' "${out}" | sed 's/^/      /' >&2
  explain_db_error "${out}"
  return 1
}
