/**
 * パイプライン全体(同期 → 分析 → 返信案 → 送信)の結合テスト。
 * Gmail API と Claude API は偽物に差し替え、実際の PostgreSQL を使う。
 *
 * 実行方法(マイグレーション適用済みの DB を用意すること):
 *   INTEGRATION_DATABASE_URL="postgresql://..." npx vitest run tests/integration
 * 環境変数が無い場合はスキップされる。
 */
import { randomUUID } from "node:crypto";
import type { gmail_v1 } from "googleapis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DB_URL = process.env.INTEGRATION_DATABASE_URL;
if (DB_URL) {
  process.env.DATABASE_URL = DB_URL;
  process.env.APP_ENCRYPTION_KEY ??= "integration-test-encryption-key";
}

const ME = "me@example.com";
const AGENT_DOMAIN = "agent.example.jp";
const OTHER_DOMAIN = "other-agent.example.jp";

type FakeMailbox = { messages: gmail_v1.Schema$Message[]; sent: { raw: string; threadId: string }[] };

function b64url(text: string): string {
  return Buffer.from(text, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeRaw(raw: string): string {
  return Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function mail(opts: {
  id: string;
  threadId: string;
  from: string;
  to?: string;
  subject: string;
  body: string;
  minutesAgo: number;
  labels?: string[];
  extraHeaders?: { name: string; value: string }[];
  inReplyTo?: string;
}): gmail_v1.Schema$Message {
  const headers = [
    { name: "From", value: opts.from },
    { name: "To", value: opts.to ?? ME },
    { name: "Subject", value: opts.subject },
    { name: "Message-ID", value: `<${opts.id}@mail.test>` },
    ...(opts.inReplyTo ? [{ name: "In-Reply-To", value: opts.inReplyTo }, { name: "References", value: opts.inReplyTo }] : []),
    ...(opts.extraHeaders ?? []),
  ];
  return {
    id: opts.id,
    threadId: opts.threadId,
    labelIds: opts.labels ?? ["INBOX"],
    snippet: opts.body.slice(0, 50),
    internalDate: String(Date.now() - opts.minutesAgo * 60_000),
    payload: { mimeType: "text/plain", headers, body: { data: b64url(opts.body) } },
  };
}

function fakeGmail(box: FakeMailbox) {
  let sentCount = 0;
  const gmail = {
    users: {
      messages: {
        list: async () => ({
          data: {
            // Gmail API と同じく新しい順に返す
            messages: [...box.messages]
              .sort((a, b) => Number(b.internalDate) - Number(a.internalDate))
              .map((m) => ({ id: m.id, threadId: m.threadId })),
          },
        }),
        get: async ({ id }: { id: string }) => {
          const found = box.messages.find((m) => m.id === id);
          if (!found) throw new Error(`not found: ${id}`);
          return { data: found };
        },
        send: async ({ requestBody }: { requestBody: { raw: string; threadId: string } }) => {
          sentCount += 1;
          const id = `sent-${sentCount}`;
          box.sent.push(requestBody);
          // 送信したメールは Gmail 上の送信済みメールとして見える
          box.messages.push({
            id,
            threadId: requestBody.threadId,
            labelIds: ["SENT"],
            internalDate: String(Date.now()),
            snippet: "sent",
            payload: {
              mimeType: "text/plain",
              headers: [
                { name: "From", value: ME },
                { name: "To", value: `sato@${AGENT_DOMAIN}` },
                { name: "Subject", value: "Re: sent" },
              ],
              body: { data: b64url("sent body") },
            },
          });
          return { data: { id, threadId: requestBody.threadId } };
        },
      },
    },
  } as unknown as gmail_v1.Gmail;
  return { gmail, accountId: "fake-account", accountEmail: ME };
}

const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

/** 件名から結果を決める偽の AI */
function fakeAi() {
  const calls = { checkSender: 0, analyze: 0, draft: 0 };
  return {
    calls,
    service: {
      async checkSender(input: { fromEmail: string }) {
        calls.checkSender += 1;
        const isAgent = input.fromEmail.endsWith(`@${AGENT_DOMAIN}`) || input.fromEmail.endsWith(`@${OTHER_DOMAIN}`);
        return {
          data: { is_freelance_agent: isAgent, confidence: 0.95, company_name: isAgent ? "株式会社テスト" : null, person_name: null, reason: "test" },
          model: "fake",
          usage,
        };
      },
      async analyzeMessage(input: { message: { subject: string } }) {
        calls.analyze += 1;
        const subject = input.message.subject;
        const isNewsletter = subject.includes("メルマガ");
        const isProposal = subject.includes("案件のご紹介");
        return {
          data: {
            is_from_freelance_agent: true,
            category: isNewsletter ? "NEWSLETTER" : isProposal ? "JOB_PROPOSAL" : "STATUS_CHECK",
            confidence: 0.95,
            summary: `要約: ${subject}`,
            needs_reply: !isNewsletter,
            needs_reply_reason: "test",
            urgency: "medium",
            sender_company_name: null,
            sender_person_name: null,
            jobs: isProposal
              ? [
                  {
                    title: "Go バックエンド開発",
                    description: "API 開発",
                    rate_min: 80,
                    rate_max: 90,
                    rate_text: "80〜90万円",
                    period: "長期",
                    start_text: "11月〜",
                    location: "フルリモート",
                    remote_policy: "フルリモート",
                    skills: ["Go"],
                    fit_score: 85,
                    fit_reason: "合致",
                  },
                ]
              : [],
            proposed_dates: [],
            questions_asked: [],
            deadline: null,
          },
          model: "fake",
          usage,
        };
      },
      async draftReply(input: { message: { subject: string } }) {
        calls.draft += 1;
        return {
          data: {
            subject: `Re: ${input.message.subject}`,
            body: "株式会社テスト\n佐藤様\n\nお世話になっております。山田です。\nご連絡ありがとうございます。\n\n山田",
            commitments: ["express_interest"],
            confidence: 0.9,
            risk_flags: [],
            requires_human_review: false,
            review_reason: null,
            reasoning: "test",
            thread_summary: "要約",
            opportunity_stage_hint: null,
          },
          model: "fake",
          usage,
        };
      },
    },
  };
}

describe.skipIf(!DB_URL)("パイプライン結合テスト", () => {
  const email = `it-${randomUUID()}@example.com`;
  let userId = "";
  const box: FakeMailbox = { messages: [], sent: [] };
  const ai = fakeAi();

  // モジュールは環境変数を設定した後に読み込む
  let prisma: typeof import("@/lib/db").prisma;
  let runTick: typeof import("@/lib/pipeline/tick").runTick;
  let tryAcquireLock: typeof import("@/lib/lock").tryAcquireLock;
  let encryptSecret: typeof import("@/lib/crypto").encryptSecret;
  let ensureUserDefaults: typeof import("@/lib/policy/defaults").ensureUserDefaults;

  const deps = () => ({ ai: ai.service as never, gmail: fakeGmail(box) });

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/db"));
    ({ runTick } = await import("@/lib/pipeline/tick"));
    ({ tryAcquireLock } = await import("@/lib/lock"));
    ({ encryptSecret } = await import("@/lib/crypto"));
    ({ ensureUserDefaults } = await import("@/lib/policy/defaults"));

    const user = await prisma.user.create({ data: { email, name: "結合テスト" } });
    userId = user.id;
    await ensureUserDefaults(userId, { displayName: "山田 太郎" });
    await prisma.googleAccount.create({
      data: {
        userId,
        googleId: `g-${randomUUID()}`,
        email: ME,
        encryptedRefreshToken: encryptSecret("dummy-refresh-token"),
        scopes: "test",
      },
    });
  });

  afterAll(async () => {
    if (!prisma || !userId) return;
    await prisma.jobLock.deleteMany({ where: { name: `tick:${userId}` } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("初回同期: エージェント判定、返信済み・古いメールの扱い、一斉配信の除外", async () => {
    box.messages.push(
      // スレッド3: 5日前の未返信メール(古いので承認制)
      mail({ id: "m6", threadId: "t3", from: `佐藤 <sato@${AGENT_DOMAIN}>`, subject: "近況のご確認", body: "ご状況いかがでしょうか", minutesAgo: 5 * 24 * 60 }),
      // スレッド2: 3日前の受信と、2日前に本人が Gmail から返信済み
      mail({ id: "m4", threadId: "t2", from: `鈴木 <suzuki@${OTHER_DOMAIN}>`, subject: "ご挨拶", body: "よろしくお願いします", minutesAgo: 3 * 24 * 60 }),
      mail({ id: "m5", threadId: "t2", from: `山田 <${ME}>`, to: `suzuki@${OTHER_DOMAIN}`, subject: "Re: ご挨拶", body: "こちらこそ", minutesAgo: 2 * 24 * 60, labels: ["SENT"], inReplyTo: "<m4@mail.test>" }),
      // 一斉配信(既知ドメインになった後に届く)
      mail({ id: "m2", threadId: "t4", from: `news@${AGENT_DOMAIN}`, subject: "メルマガ 新着案件", body: "今週の案件", minutesAgo: 120, extraHeaders: [{ name: "List-Unsubscribe", value: "<mailto:x@y>" }] }),
      // エージェント以外
      mail({ id: "m3", threadId: "t5", from: "友人 <friend@gmail.com>", subject: "飲み会", body: "今度どう?", minutesAgo: 90 }),
      // スレッド1: 新着の案件紹介
      mail({ id: "m1", threadId: "t1", from: `佐藤 <sato@${AGENT_DOMAIN}>`, subject: "【案件のご紹介】Go案件", body: "ご紹介です", minutesAgo: 60 }),
    );

    const r = await runTick(userId, deps());
    expect(r.skipped).toBeNull();
    expect(r.errors).toEqual([]);
    expect(r.sync?.ingested).toBe(5); // m3 以外
    expect(r.sync?.skipped).toBe(1);
    expect(r.sync?.newAgents).toBe(2);
    expect(r.process?.processed).toBe(4); // m6, m4, m2, m1(m5 は送信メール)

    const agents = await prisma.agent.findMany({ where: { userId }, orderBy: { name: "asc" } });
    expect(agents.map((a) => a.domains[0]).sort()).toEqual([AGENT_DOMAIN, OTHER_DOMAIN].sort());

    const threads = await prisma.thread.findMany({ where: { userId }, include: { replies: true } });
    const byGmail = Object.fromEntries(threads.map((t) => [t.gmailThreadId, t]));
    expect(byGmail.t5).toBeUndefined();

    // 返信済みのスレッド2には返信案を作らない
    expect(byGmail.t2?.replies).toHaveLength(0);
    expect(byGmail.t2?.status).toBe("WAITING_THEM");
    // 一斉配信には返信しない
    expect(byGmail.t4?.replies).toHaveLength(0);

    // スレッド1: 新規エージェントへの初回返信なので承認制
    const r1 = byGmail.t1?.replies ?? [];
    expect(r1).toHaveLength(1);
    expect(r1[0]?.status).toBe("PENDING_APPROVAL");
    expect(r1[0]?.decisionReasons.join()).toContain("新規エージェント");

    // スレッド3: 5日前のメールは承認制(経過時間の理由付き)
    const r3 = byGmail.t3?.replies ?? [];
    expect(r3).toHaveLength(1);
    expect(r3[0]?.status).toBe("PENDING_APPROVAL");
    expect(r3[0]?.decisionReasons.join()).toContain("時間以上経っている");

    // 案件の自動登録
    const opps = await prisma.opportunity.findMany({ where: { userId } });
    expect(opps.map((o) => o.title)).toEqual(["Go バックエンド開発"]);

    // 同期位置が進んでいる
    const account = await prisma.googleAccount.findUniqueOrThrow({ where: { userId } });
    expect(account.lastSyncedAt).not.toBeNull();
  });

  it("新着メールで古い返信案を取り消し、条件を満たせば自動送信を予約する", async () => {
    await prisma.replyPolicy.update({ where: { userId }, data: { requireApprovalForNewAgents: false } });
    box.messages.push(
      mail({ id: "m7", threadId: "t1", from: `佐藤 <sato@${AGENT_DOMAIN}>`, subject: "Re: 【案件のご紹介】Go案件 ご状況の確認", body: "いかがでしょうか", minutesAgo: 5, inReplyTo: "<m1@mail.test>" }),
    );

    const r = await runTick(userId, deps());
    expect(r.errors).toEqual([]);
    expect(r.sync?.ingested).toBe(1);

    const t1 = await prisma.thread.findFirstOrThrow({
      where: { userId, gmailThreadId: "t1" },
      include: { replies: { orderBy: { createdAt: "asc" } } },
    });
    expect(t1.replies.map((x) => x.status)).toEqual(["CANCELLED", "SCHEDULED"]);
    const scheduled = t1.replies[1]!;
    expect(scheduled.decision).toBe("AUTO");
    expect(scheduled.scheduledFor!.getTime()).toBeGreaterThan(Date.now());
  });

  it("送信予定時刻を過ぎた返信をスレッドへの返信として送信し、次回の同期で重複取り込みしない", async () => {
    const t1 = await prisma.thread.findFirstOrThrow({ where: { userId, gmailThreadId: "t1" } });
    await prisma.reply.updateMany({ where: { threadId: t1.id, status: "SCHEDULED" }, data: { scheduledFor: new Date(Date.now() - 60_000) } });
    const before = await prisma.message.count({ where: { threadId: t1.id } });

    const r = await runTick(userId, deps());
    expect(r.errors).toEqual([]);
    expect(r.dispatch).toEqual({ sent: 1, failed: 0 });
    expect(box.sent).toHaveLength(1);
    expect(box.sent[0]?.threadId).toBe("t1");
    const mime = decodeRaw(box.sent[0]!.raw);
    expect(mime).toContain("In-Reply-To: <m7@mail.test>");
    expect(mime).toContain("References: <m1@mail.test> <m7@mail.test>");
    expect(mime).toContain(`To: =?UTF-8?B?`); // 日本語の表示名付き
    expect(mime).toContain(`<sato@${AGENT_DOMAIN}>`);

    const after = await prisma.thread.findFirstOrThrow({ where: { id: t1.id }, include: { replies: true } });
    expect(after.status).toBe("WAITING_THEM");
    expect(after.replies.find((x) => x.status === "SENT")?.sentGmailMessageId).toBe("sent-1");
    expect(await prisma.message.count({ where: { threadId: t1.id } })).toBe(before + 1);

    // 次の同期で送信済みメールを再取り込みしない
    const r2 = await runTick(userId, deps());
    expect(r2.sync?.ingested).toBe(0);
    expect(await prisma.message.count({ where: { threadId: t1.id } })).toBe(before + 1);
  });

  it("同じユーザーの処理が実行中なら、今回はスキップする", async () => {
    const lock = await tryAcquireLock(`tick:${userId}`, 60_000);
    expect(lock).not.toBeNull();
    // 二重取得はできない
    expect(await tryAcquireLock(`tick:${userId}`, 60_000)).toBeNull();
    const r = await runTick(userId, deps());
    expect(r.skipped).toBe("locked");
    await lock!.release();
    const r2 = await runTick(userId, deps());
    expect(r2.skipped).toBeNull();
  });

  it("時間切れのときは取り込みを次回に回し、同期位置を進めない", async () => {
    box.messages.push(
      mail({ id: "m8", threadId: "t6", from: `佐藤 <sato@${AGENT_DOMAIN}>`, subject: "別件のご相談", body: "ご相談です", minutesAgo: 1 }),
    );
    const before = await prisma.googleAccount.findUniqueOrThrow({ where: { userId } });

    const r = await runTick(userId, { ...deps(), budgetSeconds: -1 });
    // エージェント以外のメール(m3)は保存しないため、同期範囲内にあれば毎回の取得対象に含まれる
    expect(r.sync?.remaining).toBeGreaterThanOrEqual(1);
    expect(r.sync?.ingested).toBe(0);
    expect(r.process?.deferred ?? 0).toBe(0);
    const mid = await prisma.googleAccount.findUniqueOrThrow({ where: { userId } });
    expect(mid.lastSyncedAt?.getTime()).toBe(before.lastSyncedAt?.getTime());

    const r2 = await runTick(userId, deps());
    expect(r2.sync?.ingested).toBe(1);
    expect(r2.process?.processed).toBe(1);
  });
});
