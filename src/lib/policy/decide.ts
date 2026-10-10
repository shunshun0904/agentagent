import type { AgentStatus, MessageCategory, PolicyMode } from "@/generated/prisma/client";

export type DecisionAction = "auto_send" | "needs_approval" | "no_reply";

export type DecisionPolicy = {
  mode: PolicyMode;
  approvalCategories: string[];
  noReplyCategories: string[];
  approvalCommitments: string[];
  requireApprovalForNewAgents: boolean;
  confidenceThreshold: number;
  maxAutoRepliesPerThreadPerDay: number;
};

export type DecisionAgent = {
  status: AgentStatus;
  autoReplyEnabled: boolean;
  requireApproval: boolean;
} | null;

export type DecisionInput = {
  policy: DecisionPolicy;
  agent: DecisionAgent;
  category: MessageCategory;
  analysisConfidence: number;
  needsReply: boolean;
  draft: {
    commitments: string[];
    confidence: number;
    requiresHumanReview: boolean;
    reviewReason: string | null;
    riskFlags: string[];
  } | null;
  isNewAgent: boolean;
  autoRepliesToday: number;
  threadMuted: boolean;
  messageIsAutoSubmitted: boolean;
  /** 受信から時間が経ちすぎている場合の経過時間(時間)。新しいメールなら null */
  staleHours: number | null;
};

export type Decision = {
  action: DecisionAction;
  reasons: string[];
};

/**
 * 返信をどう扱うかを決める。
 * 1. 返信しない条件 → no_reply
 * 2. 承認が必要な条件 → needs_approval
 * 3. それ以外 → auto_send
 */
export function decideReplyAction(input: DecisionInput): Decision {
  const { policy, agent, category, draft } = input;
  const reasons: string[] = [];

  // --- 返信しない ---
  if (input.threadMuted) return { action: "no_reply", reasons: ["スレッドがミュートされています"] };
  if (agent?.status === "BLOCKED") return { action: "no_reply", reasons: ["エージェントがブロックされています"] };
  if (input.messageIsAutoSubmitted) return { action: "no_reply", reasons: ["自動応答メールのため返信しません"] };
  if (!input.needsReply) return { action: "no_reply", reasons: ["返信不要と判定されました"] };
  if (policy.noReplyCategories.includes(category)) {
    return { action: "no_reply", reasons: [`カテゴリ「${category}」は返信しない設定です`] };
  }
  if (!draft) return { action: "needs_approval", reasons: ["返信案を生成できなかったため確認が必要です"] };

  // --- 常に承認が必要(モードに関係なく) ---
  if (agent?.status === "PAUSED") reasons.push("エージェントが一時停止中のため自動送信しません");
  if (agent && !agent.autoReplyEnabled) reasons.push("このエージェントは自動返信が無効です");
  if (agent?.requireApproval) reasons.push("このエージェントは常に承認が必要な設定です");
  if (input.autoRepliesToday >= policy.maxAutoRepliesPerThreadPerDay) {
    reasons.push(`このスレッドの本日の自動返信数が上限(${policy.maxAutoRepliesPerThreadPerDay}件)に達しています`);
  }
  if (input.staleHours !== null) {
    reasons.push(`受信から${Math.floor(input.staleHours)}時間以上経っているため確認が必要です`);
  }
  if (draft.requiresHumanReview) {
    reasons.push(draft.reviewReason ? `AIが確認を求めています: ${draft.reviewReason}` : "AIが人間の確認を求めています");
  }

  // --- モードごとの承認条件 ---
  if (policy.mode === "APPROVE_ALL") {
    reasons.push("全件承認モードです");
  } else if (policy.mode === "AUTO_WITH_APPROVAL") {
    if (policy.approvalCategories.includes(category)) {
      reasons.push(`カテゴリ「${category}」は承認が必要です`);
    }
    const hits = draft.commitments.filter((c) => policy.approvalCommitments.includes(c));
    if (hits.length > 0) {
      reasons.push(`返信に承認が必要な内容が含まれます: ${hits.join(", ")}`);
    }
    if (input.isNewAgent && policy.requireApprovalForNewAgents) {
      reasons.push("新規エージェントへの初回返信です");
    }
    if (input.analysisConfidence < policy.confidenceThreshold) {
      reasons.push(`分類の信頼度(${input.analysisConfidence.toFixed(2)})が閾値未満です`);
    }
    if (draft.confidence < policy.confidenceThreshold) {
      reasons.push(`返信案の信頼度(${draft.confidence.toFixed(2)})が閾値未満です`);
    }
  }

  if (reasons.length > 0) return { action: "needs_approval", reasons };
  return { action: "auto_send", reasons: ["ポリシーの自動返信条件を満たしています"] };
}
