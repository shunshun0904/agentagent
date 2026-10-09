import type { AgentStatus, MessageCategory, OpportunityStage, ReplyDecision, ReplyStatus, ThreadStatus } from "@/generated/prisma/client";
import {
  AGENT_STATUS_LABELS,
  CATEGORY_LABELS,
  OPPORTUNITY_STAGE_LABELS,
  REPLY_DECISION_LABELS,
  REPLY_STATUS_LABELS,
  THREAD_STATUS_LABELS,
} from "@/lib/format";

type Tone = "slate" | "indigo" | "emerald" | "amber" | "rose" | "sky" | "violet";

const TONE_CLASS: Record<Tone, string> = {
  slate: "bg-slate-100 text-slate-700 ring-slate-200",
  indigo: "bg-indigo-50 text-indigo-700 ring-indigo-200",
  emerald: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  rose: "bg-rose-50 text-rose-700 ring-rose-200",
  sky: "bg-sky-50 text-sky-700 ring-sky-200",
  violet: "bg-violet-50 text-violet-700 ring-violet-200",
};

export function Badge({ tone = "slate", children, title }: { tone?: Tone; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONE_CLASS[tone]}`}>
      {children}
    </span>
  );
}

const CATEGORY_TONE: Record<MessageCategory, Tone> = {
  INTRO: "sky",
  JOB_PROPOSAL: "indigo",
  STATUS_CHECK: "sky",
  DOCUMENT_REQUEST: "violet",
  INTERVIEW_SCHEDULING: "amber",
  INTERVIEW_CONFIRMATION: "amber",
  SELECTION_RESULT: "violet",
  RATE_NEGOTIATION: "rose",
  CONTRACT: "rose",
  THANKS_CLOSING: "slate",
  NEWSLETTER: "slate",
  OTHER: "slate",
};

export function CategoryBadge({ category }: { category: MessageCategory | null | undefined }) {
  if (!category) return <Badge tone="slate">未分類</Badge>;
  return <Badge tone={CATEGORY_TONE[category]}>{CATEGORY_LABELS[category]}</Badge>;
}

const THREAD_TONE: Record<ThreadStatus, Tone> = {
  OPEN: "indigo",
  WAITING_THEM: "sky",
  NEEDS_ACTION: "amber",
  CLOSED: "slate",
  ARCHIVED: "slate",
};

export function ThreadStatusBadge({ status }: { status: ThreadStatus }) {
  return <Badge tone={THREAD_TONE[status]}>{THREAD_STATUS_LABELS[status]}</Badge>;
}

const REPLY_TONE: Record<ReplyStatus, Tone> = {
  PENDING_APPROVAL: "amber",
  SCHEDULED: "indigo",
  SENDING: "indigo",
  SENT: "emerald",
  REJECTED: "slate",
  FAILED: "rose",
  CANCELLED: "slate",
};

export function ReplyStatusBadge({ status }: { status: ReplyStatus }) {
  return <Badge tone={REPLY_TONE[status]}>{REPLY_STATUS_LABELS[status]}</Badge>;
}

const DECISION_TONE: Record<ReplyDecision, Tone> = { AUTO: "emerald", NEEDS_APPROVAL: "amber", MANUAL: "slate" };

export function ReplyDecisionBadge({ decision }: { decision: ReplyDecision }) {
  return <Badge tone={DECISION_TONE[decision]}>{REPLY_DECISION_LABELS[decision]}</Badge>;
}

const STAGE_TONE: Record<OpportunityStage, Tone> = {
  NEW: "sky",
  INTERESTED: "indigo",
  APPLIED: "indigo",
  INTERVIEW_SCHEDULING: "amber",
  INTERVIEWED: "amber",
  OFFER: "violet",
  ACCEPTED: "emerald",
  DECLINED: "slate",
  LOST: "slate",
  CLOSED: "slate",
};

export function StageBadge({ stage }: { stage: OpportunityStage }) {
  return <Badge tone={STAGE_TONE[stage]}>{OPPORTUNITY_STAGE_LABELS[stage]}</Badge>;
}

const AGENT_TONE: Record<AgentStatus, Tone> = { ACTIVE: "emerald", PAUSED: "amber", BLOCKED: "rose" };

export function AgentStatusBadge({ status }: { status: AgentStatus }) {
  return <Badge tone={AGENT_TONE[status]}>{AGENT_STATUS_LABELS[status]}</Badge>;
}

export function FitBadge({ score }: { score: number | null }) {
  if (score === null) return null;
  const tone: Tone = score >= 80 ? "emerald" : score >= 60 ? "amber" : "slate";
  return <Badge tone={tone} title="希望条件との適合度">適合 {score}</Badge>;
}
