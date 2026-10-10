import { getEnv } from "@/lib/env";
import { structuredCompletion, type StructuredResult } from "@/lib/ai/client";
import {
  ANALYSIS_SYSTEM_PROMPT,
  DRAFT_SYSTEM_PROMPT,
  SENDER_CHECK_SYSTEM_PROMPT,
  buildAnalysisUserContent,
  buildDraftUserContent,
  buildSenderCheckUserContent,
  type AnalysisPromptInput,
  type DraftPromptInput,
  type SenderCheckPromptInput,
} from "@/lib/ai/prompts";
import { AnalysisSchema, DraftSchema, SenderCheckSchema, type Analysis, type Draft, type SenderCheck } from "@/lib/ai/schemas";

/** パイプラインが使う AI 機能。テストでは差し替えられる。 */
export type AiService = {
  analyzeMessage(input: AnalysisPromptInput): Promise<StructuredResult<Analysis>>;
  draftReply(input: DraftPromptInput): Promise<StructuredResult<Draft>>;
  checkSender(input: SenderCheckPromptInput): Promise<StructuredResult<SenderCheck>>;
};

export const defaultAiService: AiService = {
  analyzeMessage(input) {
    return structuredCompletion({
      schema: AnalysisSchema,
      system: ANALYSIS_SYSTEM_PROMPT,
      user: buildAnalysisUserContent(input),
      effort: getEnv().AGENTAGENT_ANALYSIS_EFFORT,
      // 思考(thinking)の分も max_tokens に含まれるため、出力の見込みより大きくとる
      maxTokens: 6000,
    });
  },
  draftReply(input) {
    return structuredCompletion({
      schema: DraftSchema,
      system: DRAFT_SYSTEM_PROMPT,
      user: buildDraftUserContent(input),
      effort: getEnv().AGENTAGENT_DRAFT_EFFORT,
      maxTokens: 8000,
    });
  },
  checkSender(input) {
    return structuredCompletion({
      schema: SenderCheckSchema,
      system: SENDER_CHECK_SYSTEM_PROMPT,
      user: buildSenderCheckUserContent(input),
      effort: "low",
      maxTokens: 2000,
    });
  },
};
