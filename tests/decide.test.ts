import { describe, expect, it } from "vitest";
import { decideReplyAction, type DecisionInput } from "@/lib/policy/decide";
import { DEFAULT_POLICY } from "@/lib/policy/defaults";

const policy = {
  mode: DEFAULT_POLICY.mode,
  approvalCategories: DEFAULT_POLICY.approvalCategories,
  noReplyCategories: DEFAULT_POLICY.noReplyCategories,
  approvalCommitments: DEFAULT_POLICY.approvalCommitments,
  requireApprovalForNewAgents: true,
  confidenceThreshold: 0.7,
  maxAutoRepliesPerThreadPerDay: 2,
};

const draft = {
  commitments: ["express_interest"],
  confidence: 0.9,
  requiresHumanReview: false,
  reviewReason: null,
  riskFlags: [],
};

function input(overrides: Partial<DecisionInput> = {}): DecisionInput {
  return {
    policy,
    agent: { status: "ACTIVE", autoReplyEnabled: true, requireApproval: false },
    category: "JOB_PROPOSAL",
    analysisConfidence: 0.95,
    needsReply: true,
    draft,
    isNewAgent: false,
    autoRepliesToday: 0,
    threadMuted: false,
    messageIsAutoSubmitted: false,
    ...overrides,
  };
}

describe("decideReplyAction", () => {
  it("条件を満たす案件紹介への返信は自動送信", () => {
    expect(decideReplyAction(input()).action).toBe("auto_send");
  });

  it("一斉配信には返信しない", () => {
    const d = decideReplyAction(input({ category: "NEWSLETTER", needsReply: false }));
    expect(d.action).toBe("no_reply");
  });

  it("返信不要と判定されたら返信しない", () => {
    expect(decideReplyAction(input({ needsReply: false })).action).toBe("no_reply");
  });

  it("自動応答メールには返信しない", () => {
    expect(decideReplyAction(input({ messageIsAutoSubmitted: true })).action).toBe("no_reply");
  });

  it("ブロック中のエージェントには返信しない", () => {
    const d = decideReplyAction(input({ agent: { status: "BLOCKED", autoReplyEnabled: true, requireApproval: false } }));
    expect(d.action).toBe("no_reply");
  });

  it("一時停止中のエージェントは承認待ち", () => {
    const d = decideReplyAction(input({ agent: { status: "PAUSED", autoReplyEnabled: true, requireApproval: false } }));
    expect(d.action).toBe("needs_approval");
  });

  it("日程の確定を含む返信は承認待ち", () => {
    const d = decideReplyAction(input({ draft: { ...draft, commitments: ["confirm_date"] } }));
    expect(d.action).toBe("needs_approval");
    expect(d.reasons.join()).toContain("confirm_date");
  });

  it("単価交渉カテゴリは承認待ち", () => {
    expect(decideReplyAction(input({ category: "RATE_NEGOTIATION" })).action).toBe("needs_approval");
  });

  it("新規エージェントへの初回返信は承認待ち", () => {
    expect(decideReplyAction(input({ isNewAgent: true })).action).toBe("needs_approval");
  });

  it("信頼度が閾値未満なら承認待ち", () => {
    expect(decideReplyAction(input({ analysisConfidence: 0.5 })).action).toBe("needs_approval");
    expect(decideReplyAction(input({ draft: { ...draft, confidence: 0.4 } })).action).toBe("needs_approval");
  });

  it("AI が確認を求めたら承認待ち", () => {
    const d = decideReplyAction(input({ draft: { ...draft, requiresHumanReview: true, reviewReason: "値下げ要求" } }));
    expect(d.action).toBe("needs_approval");
    expect(d.reasons[0]).toContain("値下げ要求");
  });

  it("全件承認モードでは常に承認待ち", () => {
    expect(decideReplyAction(input({ policy: { ...policy, mode: "APPROVE_ALL" } })).action).toBe("needs_approval");
  });

  it("完全自動モードではカテゴリやコミットメントを無視するが上限は守る", () => {
    const full = { ...policy, mode: "FULL_AUTO" as const };
    expect(
      decideReplyAction(input({ policy: full, category: "RATE_NEGOTIATION", draft: { ...draft, commitments: ["decline"] } })).action,
    ).toBe("auto_send");
    expect(decideReplyAction(input({ policy: full, autoRepliesToday: 2 })).action).toBe("needs_approval");
  });

  it("返信案が無い場合は承認待ち", () => {
    expect(decideReplyAction(input({ draft: null })).action).toBe("needs_approval");
  });
});
