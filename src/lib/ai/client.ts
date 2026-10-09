import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { getEnv, type EffortLevel } from "@/lib/env";

/** プロンプトを変更したら更新する。返信案に記録され、後から比較できる。 */
export const PROMPT_VERSION = "2026-10-09.1";

export type AiErrorCode = "not_configured" | "refusal" | "max_tokens" | "parse_failed";

export class AiError extends Error {
  readonly code: AiErrorCode;
  constructor(message: string, code: AiErrorCode) {
    super(message);
    this.name = "AiError";
    this.code = code;
  }
}

export type AiUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
};

export type StructuredResult<T> = {
  data: T;
  model: string;
  usage: AiUsage;
};

let client: Anthropic | undefined;

export function getAnthropicClient(): Anthropic {
  const env = getEnv();
  if (!env.ANTHROPIC_API_KEY) {
    throw new AiError("ANTHROPIC_API_KEY が設定されていません", "not_configured");
  }
  if (!client) {
    client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  }
  return client;
}

export type StructuredCompletionOptions<T> = {
  schema: z.ZodType<T>;
  system: string;
  user: string;
  effort: EffortLevel;
  maxTokens?: number;
};

/**
 * 構造化出力(JSON)で Claude を呼び出す。
 * - システムプロンプトはキャッシュ対象(内容が固定なので2回目以降は安く速い)
 * - 安全分類器による拒否時はサーバー側フォールバック("default")で別モデルに再実行される
 */
export async function structuredCompletion<T>(options: StructuredCompletionOptions<T>): Promise<StructuredResult<T>> {
  const env = getEnv();
  const anthropic = getAnthropicClient();
  const model = env.AGENTAGENT_MODEL;
  // Haiku 系はサーバー側フォールバックに対応していない
  const supportsFallback = !model.includes("haiku");

  const response = await anthropic.beta.messages.parse({
    model,
    max_tokens: options.maxTokens ?? 8000,
    ...(supportsFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    output_config: {
      effort: options.effort,
      format: betaZodOutputFormat(options.schema),
    },
    system: [{ type: "text", text: options.system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: options.user }],
  });

  if (response.stop_reason === "refusal") {
    const category = response.stop_details?.category;
    throw new AiError(`AI が処理を拒否しました${category ? ` (${category})` : ""}`, "refusal");
  }
  if (response.stop_reason === "max_tokens") {
    throw new AiError("AI の出力が長すぎて途中で打ち切られました", "max_tokens");
  }
  const data = response.parsed_output;
  if (!data) {
    throw new AiError("AI の出力を解析できませんでした", "parse_failed");
  }
  return {
    data,
    model: response.model,
    usage: {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cache_read_input_tokens: response.usage.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? 0,
    },
  };
}
