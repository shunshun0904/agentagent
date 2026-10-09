import { z } from "zod";
import { COMMITMENT_TYPES } from "@/lib/policy/defaults";

export const MESSAGE_CATEGORIES = [
  "INTRO",
  "JOB_PROPOSAL",
  "STATUS_CHECK",
  "DOCUMENT_REQUEST",
  "INTERVIEW_SCHEDULING",
  "INTERVIEW_CONFIRMATION",
  "SELECTION_RESULT",
  "RATE_NEGOTIATION",
  "CONTRACT",
  "THANKS_CLOSING",
  "NEWSLETTER",
  "OTHER",
] as const;

export const OPPORTUNITY_STAGES = [
  "NEW",
  "INTERESTED",
  "APPLIED",
  "INTERVIEW_SCHEDULING",
  "INTERVIEWED",
  "OFFER",
  "ACCEPTED",
  "DECLINED",
  "LOST",
  "CLOSED",
] as const;

export const JobSchema = z.object({
  title: z.string().describe("案件名、または案件を一言で表した要約"),
  description: z.string().describe("案件内容の要約(100字程度)"),
  rate_min: z.number().nullable().describe("月額単価の下限(万円)。不明なら null"),
  rate_max: z.number().nullable().describe("月額単価の上限(万円)。不明なら null"),
  rate_text: z.string().nullable().describe("単価の原文(例: 〜80万円、時給5,000円)。記載が無ければ null"),
  period: z.string().nullable().describe("契約期間(例: 3ヶ月〜長期)"),
  start_text: z.string().nullable().describe("稼働開始時期の原文(例: 11月〜、即日)"),
  location: z.string().nullable().describe("勤務地"),
  remote_policy: z.string().nullable().describe("リモート可否(例: フルリモート、週2出社)"),
  skills: z.array(z.string()).describe("必要スキル・技術"),
  fit_score: z.number().describe("本人の希望条件との適合度 0〜100"),
  fit_reason: z.string().describe("適合度の根拠と不足している情報"),
});
export type ExtractedJob = z.infer<typeof JobSchema>;

export const AnalysisSchema = z.object({
  is_from_freelance_agent: z.boolean().describe("送信者がフリーランスエージェント(案件紹介会社・SES営業など)の担当者か"),
  category: z.enum(MESSAGE_CATEGORIES),
  confidence: z.number().describe("分類の確信度 0〜1"),
  summary: z.string().describe("メールの要約。日本語で1〜2文"),
  needs_reply: z.boolean().describe("返信すべきか"),
  needs_reply_reason: z.string().describe("返信要否の理由(日本語で1文)"),
  urgency: z.enum(["low", "medium", "high"]),
  sender_company_name: z.string().nullable().describe("送信者の会社名。不明なら null"),
  sender_person_name: z.string().nullable().describe("送信者の氏名。不明なら null"),
  jobs: z.array(JobSchema).describe("紹介された案件。無ければ空配列"),
  proposed_dates: z.array(z.string()).describe("相手が提示した候補日時(原文のまま)"),
  questions_asked: z.array(z.string()).describe("相手が本人に尋ねている質問"),
  deadline: z.string().nullable().describe("回答期限(原文のまま)。無ければ null"),
});
export type Analysis = z.infer<typeof AnalysisSchema>;

export const DraftSchema = z.object({
  subject: z.string().describe("返信メールの件名"),
  body: z.string().describe("返信メールの本文全文(宛名、挨拶、本文、結び、署名を含むプレーンテキスト)"),
  commitments: z.array(z.enum(COMMITMENT_TYPES)).describe("返信に含まれる約束や表明。無ければ [\"none\"]"),
  confidence: z.number().describe("この返信をそのまま送ってよい確信度 0〜1"),
  risk_flags: z.array(z.string()).describe("送信前に本人が確認すべき点"),
  requires_human_review: z.boolean().describe("本人の判断が必要か"),
  review_reason: z.string().nullable().describe("本人の判断が必要な理由。不要なら null"),
  reasoning: z.string().describe("この返信にした理由(日本語で2〜3文)"),
  thread_summary: z.string().describe("今回の返信を含めたスレッドの要約(1〜3文)"),
  opportunity_stage_hint: z.enum(OPPORTUNITY_STAGES).nullable().describe("このスレッドの案件の現在の段階。不明なら null"),
});
export type Draft = z.infer<typeof DraftSchema>;

export const SenderCheckSchema = z.object({
  is_freelance_agent: z.boolean(),
  confidence: z.number().describe("判定の確信度 0〜1"),
  company_name: z.string().nullable().describe("会社名。不明なら null"),
  person_name: z.string().nullable().describe("担当者名。不明なら null"),
  reason: z.string().describe("判定理由(日本語で1文)"),
});
export type SenderCheck = z.infer<typeof SenderCheckSchema>;
