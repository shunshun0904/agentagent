import { z } from "zod";

const EffortSchema = z.enum(["low", "medium", "high", "xhigh", "max"]);

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL を設定してください"),
  APP_URL: z.url().default("http://localhost:3000"),
  APP_ENCRYPTION_KEY: z.string().min(16, "APP_ENCRYPTION_KEY は16文字以上の文字列にしてください"),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  ALLOWED_GOOGLE_EMAILS: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  AGENTAGENT_MODEL: z.string().default("claude-opus-5-5"),
  AGENTAGENT_DRAFT_EFFORT: EffortSchema.default("medium"),
  AGENTAGENT_ANALYSIS_EFFORT: EffortSchema.default("low"),
  CRON_SECRET: z.string().optional(),
  DEV_LOGIN_ENABLED: z.string().optional(),
  GMAIL_SYNC_QUERY: z.string().optional(),
  GMAIL_SYNC_LOOKBACK_DAYS: z.coerce.number().int().positive().default(14),
  GMAIL_SYNC_MAX_MESSAGES: z.coerce.number().int().positive().default(200),
  SENDER_CHECKS_PER_SYNC: z.coerce.number().int().nonnegative().default(40),
  SYNC_INTERVAL_SECONDS: z.coerce.number().int().positive().default(300),
});

export type Env = z.infer<typeof EnvSchema>;
export type EffortLevel = z.infer<typeof EffortSchema>;

let cached: Env | undefined;

/**
 * 環境変数を検証して返す。初回アクセス時に検証するため、ビルド時に
 * 環境変数が無くてもモジュールの読み込み自体は失敗しない。
 */
export function getEnv(): Env {
  if (!cached) {
    const result = EnvSchema.safeParse(process.env);
    if (!result.success) {
      const detail = result.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join(", ");
      throw new Error(`環境変数が不正です: ${detail}`);
    }
    cached = result.data;
  }
  return cached;
}

export function isDevLoginEnabled(): boolean {
  const env = getEnv();
  return env.NODE_ENV !== "production" && env.DEV_LOGIN_ENABLED === "true";
}

export function isGoogleConfigured(): boolean {
  const env = getEnv();
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

export function isAnthropicConfigured(): boolean {
  return Boolean(getEnv().ANTHROPIC_API_KEY);
}

/** ログインを許可するメールアドレス。未設定なら null(全員許可)。 */
export function allowedGoogleEmails(): string[] | null {
  const raw = getEnv().ALLOWED_GOOGLE_EMAILS;
  if (!raw || raw.trim() === "") return null;
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}
