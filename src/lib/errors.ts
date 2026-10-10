/**
 * 外部 API(Gmail、Claude)やデータベースのエラーの分類。
 * 同期処理で「待ってやり直す」「次回に回す」「そのメールだけ飛ばす」を決めるために使う。
 */

const NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "ETIMEDOUT",
  "EPIPE",
  "EAI_AGAIN",
  "ENOTFOUND",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "UND_ERR_SOCKET",
  "UND_ERR_CONNECT_TIMEOUT",
]);

/** Prisma の接続系エラー(DB に届かない、接続が切れた、接続プールの待ち時間切れ) */
const PRISMA_CONNECTION_CODES = new Set(["P1001", "P1002", "P1008", "P1017", "P2024"]);

const TRANSIENT_NAMES = new Set(["APIConnectionError", "APIConnectionTimeoutError", "PrismaClientInitializationError"]);

const TRANSIENT_MESSAGE =
  /quota exceeded|rate ?limit|too many requests|backend error|overloaded|timed? ?out|socket hang up|connection terminated|can't reach database|server closed the connection|too many (clients|connections)/i;

const CONFIGURATION_MESSAGE = /invalid_grant|invalid authentication|insufficient permission/i;

type ErrorLike = {
  name?: unknown;
  message?: unknown;
  code?: unknown;
  status?: unknown;
  response?: { status?: unknown };
  cause?: unknown;
};

function asErrorLike(error: unknown): ErrorLike | null {
  return typeof error === "object" && error !== null ? (error as ErrorLike) : null;
}

function toHttpStatus(value: unknown): number | null {
  const n = typeof value === "string" && /^\d{3}$/.test(value) ? Number(value) : value;
  return typeof n === "number" && Number.isInteger(n) && n >= 100 && n < 600 ? n : null;
}

function httpStatus(e: ErrorLike): number | null {
  return toHttpStatus(e.response?.status) ?? toHttpStatus(e.status) ?? toHttpStatus(e.code);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 少し待てば成功する見込みのあるエラー(利用上限、サーバー側の一時的な失敗、通信や DB 接続の失敗) */
export function isTransientError(error: unknown): boolean {
  const e = asErrorLike(error);
  if (!e) return false;
  const status = httpStatus(e);
  if (status === 408 || status === 429 || (status !== null && status >= 500)) return true;
  if (typeof e.code === "string") {
    if (NETWORK_CODES.has(e.code) || PRISMA_CONNECTION_CODES.has(e.code)) return true;
    // PostgreSQL の接続エラー(08xxx)、接続数の上限、管理者による切断
    if (/^08[0-9A-Z]{3}$/.test(e.code) || e.code === "53300" || e.code === "57P01") return true;
  }
  if (typeof e.name === "string" && TRANSIENT_NAMES.has(e.name)) return true;
  if (TRANSIENT_MESSAGE.test(errorMessage(error))) return true;
  return e.cause !== undefined && e.cause !== error && isTransientError(e.cause);
}

/** 設定や認証の問題で、どのメールでも失敗するエラー(トークン切れ、権限不足、API キー未設定) */
export function isConfigurationError(error: unknown): boolean {
  const e = asErrorLike(error);
  if (!e) return false;
  if (e.name === "AiError") return e.code === "not_configured";
  if (e.name === "GmailNotConnectedError") return true;
  const status = httpStatus(e);
  if (status === 401 || (status === 403 && !isTransientError(error))) return true;
  return CONFIGURATION_MESSAGE.test(errorMessage(error));
}

/** メールを飛ばさず、次回の処理でやり直すべきエラーか */
export function shouldRetryLater(error: unknown): boolean {
  return isTransientError(error) || isConfigurationError(error);
}
