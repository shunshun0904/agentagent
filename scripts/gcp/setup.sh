#!/usr/bin/env bash
#
# エージェントエージェント: Google Cloud セットアップスクリプト
#
# Google Cloud コンソールの Cloud Shell で、このリポジトリのディレクトリから実行する:
#   bash scripts/gcp/setup.sh
#
# 何度実行してもよい(既にあるものは再利用し、設定を最新にする)。行うこと:
#   1. 必要な API の有効化
#   2. 実行用サービスアカウントの作成と権限付与
#   3. シークレット(DB 接続文字列、API キーなど)の登録
#   4. Cloud Run へのデプロイ(Dockerfile からビルド)
#   5. Cloud Scheduler(定期実行)の登録
#   6. Artifact Registry の古いイメージを自動削除する設定
#
# 入力は対話形式で聞く。環境変数で事前に渡すこともできる(例: ANTHROPIC_API_KEY=... bash scripts/gcp/setup.sh)。
# 登録済みのシークレットを変更するときは UPDATE_SECRETS=true を付けて実行する。
# デプロイの前に、DB 接続文字列で実際に接続できるかを psql で確認する(SKIP_DB_CHECK=true で省略)。
#
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

SCHEDULE="${SCHEDULE:-*/5 * * * *}"
TIME_ZONE="${TIME_ZONE:-Asia/Tokyo}"
AGENTAGENT_MODEL="${AGENTAGENT_MODEL:-claude-opus-5-5}"
TICK_TIME_BUDGET_SECONDS="${TICK_TIME_BUDGET_SECONDS:-240}"
DATABASE_SSL="${DATABASE_SSL:-no-verify}"
UPDATE_SECRETS="${UPDATE_SECRETS:-false}"
SKIP_HEALTH_CHECK="${SKIP_HEALTH_CHECK:-false}"
SKIP_DB_CHECK="${SKIP_DB_CHECK:-false}"

command -v gcloud >/dev/null || die "gcloud が見つかりません。Google Cloud の Cloud Shell で実行してください"
command -v python3 >/dev/null || die "python3 が見つかりません"
command -v openssl >/dev/null || die "openssl が見つかりません"
command -v psql >/dev/null || warn "psql が見つかりません。データベースへの接続確認を省略します"

require_project
info "プロジェクト: ${PROJECT_ID}(番号 ${PROJECT_NUMBER}) / リージョン: ${REGION} / サービス: ${SERVICE}"

billing="$(gcloud billing projects describe "${PROJECT_ID}" --format='value(billingEnabled)' 2>/dev/null || true)"
if [[ "${billing,,}" != "true" ]]; then
  warn "このプロジェクトで課金(請求先アカウント)が有効か確認できませんでした。Cloud Run と Cloud Build には請求先アカウントの設定が必要です(無料枠内なら請求は発生しません)"
fi

# ---------------------------------------------------------------------------
info "[1/6] API を有効化しています(初回は数分かかります)"
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  cloudscheduler.googleapis.com \
  iam.googleapis.com \
  gmail.googleapis.com \
  --project "${PROJECT_ID}"

# ---------------------------------------------------------------------------
info "[2/6] サービスアカウントと権限を設定しています"
if ! gcloud iam service-accounts describe "${RUNTIME_SA}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud iam service-accounts create "${RUNTIME_SA_NAME}" \
    --display-name "AgentAgent (Cloud Run)" \
    --project "${PROJECT_ID}"
fi
# ソースからのデプロイでは Cloud Build が Compute Engine のデフォルトサービスアカウントでビルドする
gcloud projects add-iam-policy-binding "${PROJECT_ID}" \
  --member "serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role "roles/run.builder" \
  --condition None \
  --quiet >/dev/null
ok "  実行用サービスアカウント: ${RUNTIME_SA}"

# ---------------------------------------------------------------------------
info "[3/6] シークレットを登録しています"
SECRET_FLAGS=()

# 入力値を検査する。DB 接続文字列は正規化した値を返す(問題があれば理由を表示して失敗する)
prepare_value() {
  local env_name="$1" value="$2"
  case "${env_name}" in
    DATABASE_URL | DIRECT_URL)
      normalize_db_url "${env_name}" "${value}"
      ;;
    ANTHROPIC_API_KEY)
      [[ "${value}" == sk-ant-* ]] || warn "ANTHROPIC_API_KEY が sk-ant- で始まっていません。値を確認してください"
      printf '%s' "${value}"
      ;;
    *)
      printf '%s' "${value}"
      ;;
  esac
}

# ensure_secret 環境変数名 モード(prompt|generate|optional) 説明
ensure_secret() {
  local env_name="$1" mode="$2" label="$3"
  local secret_id
  secret_id="$(secret_id_for "${env_name}")"
  local exists=false
  if gcloud secrets describe "${secret_id}" --project "${PROJECT_ID}" >/dev/null 2>&1; then exists=true; fi

  local should_write=false
  if [[ "${exists}" == false ]]; then
    should_write=true
  elif [[ "${UPDATE_SECRETS}" == "true" && "${mode}" != "generate" ]]; then
    should_write=true
  fi

  if [[ "${should_write}" == true ]]; then
    local value="${!env_name:-}"
    if [[ -z "${value}" ]]; then
      case "${mode}" in
        generate)
          if [[ "${env_name}" == "CRON_SECRET" ]]; then value="$(openssl rand -hex 32)"; else value="$(openssl rand -base64 32)"; fi
          ;;
        optional)
          return 0
          ;;
        *)
          value="$(prompt_value "${label}")"
          ;;
      esac
    fi
    local prepared attempts=0
    while [[ -z "${value}" ]] || ! prepared="$(prepare_value "${env_name}" "${value}")"; do
      attempts=$((attempts + 1))
      if [[ "${mode}" == "prompt" ]] && is_interactive && [[ ${attempts} -lt 4 ]]; then
        value="$(prompt_value "${label} を入力し直してください")"
      else
        die "${label} が正しくありません"
      fi
    done
    write_secret "${secret_id}" "${prepared}"
    ok "  - ${secret_id}: 登録しました"
  else
    ok "  - ${secret_id}: 登録済み"
  fi

  gcloud secrets add-iam-policy-binding "${secret_id}" \
    --member "serviceAccount:${RUNTIME_SA}" \
    --role "roles/secretmanager.secretAccessor" \
    --project "${PROJECT_ID}" \
    --quiet >/dev/null
  SECRET_FLAGS+=("${env_name}=${secret_id}:latest")
}

# 登録済みの DB 接続文字列を検査・修正し、実際に接続できるか確認する。
# 接続できなければ理由を表示し、対話中なら入力し直してもらう。
verify_db_secret() {
  local env_name="$1" label="$2"
  local secret_id stored value fixed attempt
  secret_id="$(secret_id_for "${env_name}")"
  stored="$(read_secret "${secret_id}")" || die "${secret_id} を読み取れません"
  value="${stored}"
  for attempt in 1 2 3 4; do
    if fixed="$(normalize_db_url "${env_name}" "${value}")"; then
      value="${fixed}"
      if [[ "${value}" != "${stored}" ]]; then
        write_secret "${secret_id}" "${value}"
        stored="${value}"
        ok "  - ${secret_id}: 接続文字列を保存し直しました"
      fi
      if check_db_connection "${env_name}" "${value}"; then
        return 0
      fi
    fi
    if ! is_interactive || [[ ${attempt} -ge 4 ]]; then
      die "${env_name} でデータベースに接続できません。接続文字列を確認して、もう一度 bash scripts/gcp/setup.sh を実行してください"
    fi
    value="$(prompt_value "${label} を入力し直してください")"
    [[ -n "${value}" ]] || die "値が空です"
  done
}

ensure_secret DATABASE_URL prompt "Supabase の Transaction pooler の接続文字列(ポート 6543、パスワード入り)"
ensure_secret DIRECT_URL prompt "Supabase の Session pooler の接続文字列(ポート 5432、パスワード入り)"
ensure_secret GOOGLE_CLIENT_SECRET prompt "Google OAuth クライアントシークレット"
ensure_secret ANTHROPIC_API_KEY prompt "Anthropic API キー"
ensure_secret APP_ENCRYPTION_KEY generate "トークン暗号化キー(自動生成)"
ensure_secret CRON_SECRET generate "定期実行の認証シークレット(自動生成)"
if [[ "${DATABASE_SSL}" == "verify" ]]; then
  ensure_secret DATABASE_CA_CERT prompt "Supabase の CA 証明書(PEM の内容)"
fi

info "  データベースへの接続を確認しています"
verify_db_secret DIRECT_URL "Supabase の Session pooler の接続文字列(ポート 5432、パスワード入り)"
verify_db_secret DATABASE_URL "Supabase の Transaction pooler の接続文字列(ポート 6543、パスワード入り)"

# ---------------------------------------------------------------------------
info "[4/6] Cloud Run にデプロイしています(ビルドを含め 5〜10 分程度かかります)"

GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID:-$(service_env GOOGLE_CLIENT_ID)}"
if [[ -z "${GOOGLE_CLIENT_ID}" ]]; then
  read -r -p "  Google OAuth クライアント ID(xxxx.apps.googleusercontent.com): " GOOGLE_CLIENT_ID
fi
[[ -n "${GOOGLE_CLIENT_ID}" ]] || die "Google OAuth クライアント ID が空です"
[[ "${GOOGLE_CLIENT_ID}" == *.apps.googleusercontent.com ]] || warn "クライアント ID が .apps.googleusercontent.com で終わっていません。値を確認してください"

ALLOWED_GOOGLE_EMAILS="${ALLOWED_GOOGLE_EMAILS:-$(service_env ALLOWED_GOOGLE_EMAILS)}"
if [[ -z "${ALLOWED_GOOGLE_EMAILS}" ]]; then
  default_email="$(gcloud config get-value account 2>/dev/null || true)"
  read -r -p "  ログインを許可する Gmail アドレス(カンマ区切り)[${default_email}]: " ALLOWED_GOOGLE_EMAILS
  ALLOWED_GOOGLE_EMAILS="${ALLOWED_GOOGLE_EMAILS:-${default_email}}"
fi
[[ -n "${ALLOWED_GOOGLE_EMAILS}" ]] || die "ログインを許可するメールアドレスが空です"

APP_URL="${APP_URL:-$(service_env APP_URL)}"
APP_URL="${APP_URL:-${DEFAULT_APP_URL}}"

# 値にカンマを含められるよう、区切り文字を ## にする
ENV_VARS="^##^APP_URL=${APP_URL}##GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}##ALLOWED_GOOGLE_EMAILS=${ALLOWED_GOOGLE_EMAILS}##DATABASE_SSL=${DATABASE_SSL}##AGENTAGENT_MODEL=${AGENTAGENT_MODEL}##TICK_TIME_BUDGET_SECONDS=${TICK_TIME_BUDGET_SECONDS}"
SECRETS_ARG="$(IFS=,; echo "${SECRET_FLAGS[*]}")"

if ! gcloud run deploy "${SERVICE}" \
  --source "${REPO_ROOT}" \
  --region "${REGION}" \
  --project "${PROJECT_ID}" \
  --service-account "${RUNTIME_SA}" \
  --allow-unauthenticated \
  --cpu 1 \
  --memory 1Gi \
  --timeout 900 \
  --concurrency 20 \
  --min-instances 0 \
  --max-instances 2 \
  --set-env-vars "${ENV_VARS}" \
  --set-secrets "${SECRETS_ARG}" \
  --quiet; then
  warn "デプロイに失敗しました。Cloud Run の直近のログを表示します"
  print_recent_logs 60 >&2
  die "上のログの [entrypoint] で始まる行に原因が出ています。解決しない場合は、このログを共有してください"
fi

# 決定的 URL が割り当てられていなければ、実際の URL を APP_URL に設定し直す
mapfile -t urls < <(service_urls)
if [[ ${#urls[@]} -gt 0 ]] && ! printf '%s\n' "${urls[@]}" | grep -qxF "${APP_URL}"; then
  APP_URL="${urls[0]}"
  warn "APP_URL を ${APP_URL} に設定し直します"
  gcloud run services update "${SERVICE}" --region "${REGION}" --project "${PROJECT_ID}" \
    --update-env-vars "APP_URL=${APP_URL}" --quiet >/dev/null
fi
ok "  デプロイ完了: ${APP_URL}"

if [[ "${SKIP_HEALTH_CHECK}" != "true" ]]; then
  if curl -fsS --max-time 60 "${APP_URL}/api/health" >/dev/null; then
    ok "  ヘルスチェック: OK"
  else
    warn "ヘルスチェックに失敗しました。Cloud Run のログを確認してください(DB 接続文字列の誤りが多い原因です)"
  fi
fi

# ---------------------------------------------------------------------------
info "[5/6] Cloud Scheduler を設定しています(${SCHEDULE} / ${TIME_ZONE})"
CRON_SECRET_VALUE="$(gcloud secrets versions access latest --secret "$(secret_id_for CRON_SECRET)" --project "${PROJECT_ID}")"
if gcloud scheduler jobs describe "${JOB_NAME}" --location "${REGION}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
  gcloud scheduler jobs delete "${JOB_NAME}" --location "${REGION}" --project "${PROJECT_ID}" --quiet >/dev/null
fi
gcloud scheduler jobs create http "${JOB_NAME}" \
  --location "${REGION}" \
  --project "${PROJECT_ID}" \
  --schedule "${SCHEDULE}" \
  --time-zone "${TIME_ZONE}" \
  --uri "${APP_URL}/api/cron/tick" \
  --http-method GET \
  --headers "x-cron-secret=${CRON_SECRET_VALUE}" \
  --attempt-deadline 600s \
  --quiet >/dev/null
ok "  定期実行ジョブ: ${JOB_NAME}"

# ---------------------------------------------------------------------------
info "[6/6] 古いコンテナイメージの自動削除を設定しています"
POLICY_FILE="$(mktemp)"
cat >"${POLICY_FILE}" <<'JSON'
[
  {
    "name": "keep-latest-3",
    "action": { "type": "Keep" },
    "mostRecentVersions": { "keepCount": 3 }
  },
  {
    "name": "delete-older-than-7d",
    "action": { "type": "Delete" },
    "condition": { "tagState": "any", "olderThan": "7d" }
  }
]
JSON
if gcloud artifacts repositories set-cleanup-policies cloud-run-source-deploy \
  --location "${REGION}" --project "${PROJECT_ID}" --policy "${POLICY_FILE}" --no-dry-run --quiet >/dev/null 2>&1; then
  ok "  最新3件を残し、7日より古いイメージを自動削除します"
else
  warn "クリーンアップポリシーを設定できませんでした(動作には影響しません)。Artifact Registry の cloud-run-source-deploy リポジトリで手動設定できます"
fi
rm -f "${POLICY_FILE}"

# ---------------------------------------------------------------------------
cat <<DONE

$(ok "セットアップが完了しました")

アプリの URL:
  ${APP_URL}

残りの作業(Google Cloud コンソール):
  1. 「API とサービス」→「認証情報」→ OAuth クライアントを開き、
     承認済みのリダイレクト URI に次を追加して保存する:
       ${APP_URL}/api/auth/google/callback
  2. 「OAuth 同意画面」で公開ステータスを「本番環境」にする
     (「テスト」のままだと 7 日ごとに再ログインが必要になります)
  3. ${APP_URL} を開き、Google でログインする
  4. 設定画面でプロフィールと返信ポリシーを入力する

コードを更新したときの再デプロイ:
  bash scripts/gcp/deploy.sh
シークレットを変更するとき(例: API キーの更新):
  bash scripts/gcp/set-secret.sh ANTHROPIC_API_KEY
DONE
