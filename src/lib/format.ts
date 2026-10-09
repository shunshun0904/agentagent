import type {
  AgentStatus,
  AvailabilityStatus,
  MessageCategory,
  OpportunityStage,
  PolicyMode,
  ReplyDecision,
  ReplyStatus,
  ThreadStatus,
  WorkStyle,
} from "@/generated/prisma/client";

export const CATEGORY_LABELS: Record<MessageCategory, string> = {
  INTRO: "挨拶・初回連絡",
  JOB_PROPOSAL: "案件紹介",
  STATUS_CHECK: "状況確認",
  DOCUMENT_REQUEST: "資料依頼",
  INTERVIEW_SCHEDULING: "面談日程調整",
  INTERVIEW_CONFIRMATION: "面談確定",
  SELECTION_RESULT: "選考結果",
  RATE_NEGOTIATION: "単価・条件交渉",
  CONTRACT: "契約・事務",
  THANKS_CLOSING: "お礼・締め",
  NEWSLETTER: "一斉配信",
  OTHER: "その他",
};

export const THREAD_STATUS_LABELS: Record<ThreadStatus, string> = {
  OPEN: "対応中",
  WAITING_THEM: "相手待ち",
  NEEDS_ACTION: "要対応",
  CLOSED: "完了",
  ARCHIVED: "アーカイブ",
};

export const REPLY_STATUS_LABELS: Record<ReplyStatus, string> = {
  PENDING_APPROVAL: "承認待ち",
  SCHEDULED: "送信予定",
  SENDING: "送信中",
  SENT: "送信済み",
  REJECTED: "却下",
  FAILED: "送信失敗",
  CANCELLED: "取消",
};

export const REPLY_DECISION_LABELS: Record<ReplyDecision, string> = {
  AUTO: "自動返信",
  NEEDS_APPROVAL: "承認制",
  MANUAL: "手動",
};

export const OPPORTUNITY_STAGE_LABELS: Record<OpportunityStage, string> = {
  NEW: "新規",
  INTERESTED: "検討中",
  APPLIED: "応募済",
  INTERVIEW_SCHEDULING: "面談調整中",
  INTERVIEWED: "面談済",
  OFFER: "オファー",
  ACCEPTED: "契約",
  DECLINED: "辞退",
  LOST: "見送り",
  CLOSED: "終了",
};

export const OPPORTUNITY_STAGE_ORDER: OpportunityStage[] = [
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
];

export const AGENT_STATUS_LABELS: Record<AgentStatus, string> = {
  ACTIVE: "有効",
  PAUSED: "一時停止",
  BLOCKED: "ブロック",
};

export const POLICY_MODE_LABELS: Record<PolicyMode, string> = {
  AUTO_WITH_APPROVAL: "自動返信 + 重要案件のみ承認",
  APPROVE_ALL: "全件承認",
  FULL_AUTO: "完全自動",
};

export const WORK_STYLE_LABELS: Record<WorkStyle, string> = {
  REMOTE_ONLY: "フルリモートのみ",
  HYBRID: "一部出社可",
  ONSITE_OK: "常駐可",
};

export const AVAILABILITY_LABELS: Record<AvailabilityStatus, string> = {
  LOOKING: "案件を探している",
  OPEN_TO_OFFERS: "良い案件があれば検討",
  NOT_LOOKING: "現在は探していない",
};

export const COMMITMENT_LABELS: Record<string, string> = {
  express_interest: "興味を表明",
  decline: "辞退",
  propose_dates: "候補日を提示",
  confirm_date: "日時を確定",
  share_rate: "単価を提示",
  agree_terms: "条件に合意",
  send_document: "資料送付を約束",
  share_personal_info: "個人情報を開示",
  none: "コミットなし",
};

const DEFAULT_TZ = "Asia/Tokyo";

export function formatDateTime(date: Date | string | null | undefined, timeZone = DEFAULT_TZ): string {
  if (!date) return "-";
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export function formatDate(date: Date | string | null | undefined, timeZone = DEFAULT_TZ): string {
  if (!date) return "-";
  const d = typeof date === "string" ? new Date(date) : date;
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** 「3分前」「2時間前」「昨日」などの相対表記 */
export function formatRelative(date: Date | string, now = new Date()): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const diffMs = now.getTime() - d.getTime();
  const future = diffMs < 0;
  const abs = Math.abs(diffMs);
  const minutes = Math.round(abs / 60000);
  const hours = Math.round(abs / 3600000);
  const days = Math.round(abs / 86400000);
  let text: string;
  if (minutes < 1) text = "たった今";
  else if (minutes < 60) text = `${minutes}分`;
  else if (hours < 24) text = `${hours}時間`;
  else if (days < 30) text = `${days}日`;
  else return formatDate(d);
  if (text === "たった今") return text;
  return future ? `${text}後` : `${text}前`;
}

export function formatRate(min: number | null, max: number | null, text: string | null): string {
  if (min && max && min !== max) return `${min}〜${max}万円/月`;
  if (min) return `${min}万円/月〜`;
  if (max) return `〜${max}万円/月`;
  return text ?? "未定";
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "-";
  return `${Math.round(value * 100)}%`;
}
