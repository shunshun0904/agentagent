/**
 * パイプライン全体(同期 → 分析 → 返信案 → 送信)の結合テスト。
 * Gmail API と Claude API は偽物に差し替え、実際の PostgreSQL を使う。
 *
 * 実行方法(マイグレーション適用済みの DB を用意すること):
 *   INTEGRATION_DATABASE_URL="postgresql://..." npx vitest run tests/integration
 * 環境変数が無い場合はスキップされる。
 */
import { randomUUID } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
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
const THIRD_DOMAIN = "third-agent.example.jp";
const FOURTH_DOMAIN = "fourth-agent.example.jp";

type FakeMailbox = {
  messages: gmail_v1.Schema$Message[];
  sent: { raw: string; threadId: string }[];
  /** messages.get で取得したメール ID(取得の重複を確かめる) */
  fetched: string[];
  /** メール ID ごとに、残りの回数だけ利用上限エラーを返す */
  rateLimited: Map<string, number>;
  /** messages.list に渡された検索条件 */
  queries: string[];
};

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
        list: async ({ q }: { q: string }) => {
          box.queries.push(q);
          return {
            data: {
              // Gmail API と同じく新しい順に返す
              messages: [...box.messages]
                .sort((a, b) => Number(b.internalDate) - Number(a.internalDate))
                .map((m) => ({ id: m.id, threadId: m.threadId })),
            },
          };
        },
        get: async ({ id }: { id: string }) => {
          box.fetched.push(id);
          const failures = box.rateLimited.get(id) ?? 0;
          if (failures > 0) {
            box.rateLimited.set(id, failures - 1);
            throw Object.assign(new Error("Quota exceeded for quota metric 'Queries' and limit 'Queries per minute per user'"), { code: 429 });
          }
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
  /** true の間は、API キーが無効なときと同じエラー(401)を返す */
  const control = { invalidKey: false };
  const failIfInvalidKey = () => {
    if (control.invalidKey) {
      throw Anthropic.APIError.generate(
        401,
        { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } },
        undefined,
        new Headers(),
      );
    }
  };
  return {
    calls,
    control,
    service: {
      async checkSender(input: { fromEmail: string }) {
        failIfInvalidKey();
        calls.checkSender += 1;
        const isAgent = [AGENT_DOMAIN, OTHER_DOMAIN, THIRD_DOMAIN, FOURTH_DOMAIN].some((d) => input.fromEmail.endsWith(`@${d}`));
        return {
          data: { is_freelance_agent: isAgent, confidence: 0.95, company_name: isAgent ? "株式会社テスト" : null, person_name: null, reason: "test" },
          model: "fake",
          usage,
        };
      },
      async analyzeMessage(input: { message: { subject: string } }) {
        failIfInvalidKey();
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
  const box: FakeMailbox = { messages: [], sent: [], fetched: [], rateLimited: new Map(), queries: [] };
  const ai = fakeAi();

  // モジュールは環境変数を設定した後に読み込む
  let prisma: typeof import("@/lib/db").prisma;
  let runTick: typeof import("@/lib/pipeline/tick").runTick;
  let tryAcquireLock: typeof import("@/lib/lock").tryAcquireLock;
  let encryptSecret: typeof import("@/lib/crypto").encryptSecret;
  let ensureUserDefaults: typeof import("@/lib/policy/defaults").ensureUserDefaults;

  const deps = () => ({
    ai: ai.service as never,
    gmail: fakeGmail(box),
    gmailMinIntervalMs: 0,
    gmailUnitsPerMinute: Number.POSITIVE_INFINITY,
    sleep: async () => {},
  });

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

    // 初回は取り込み範囲(既定 30 日)全体を一覧し、取り込みを済ませた日数と同期位置を記録する
    expect(box.queries[0]).toContain("newer_than:30d");
    const account = await prisma.googleAccount.findUniqueOrThrow({ where: { userId } });
    expect(account.lastSyncedAt).not.toBeNull();
    expect(account.syncedLookbackDays).toBe(30);

    // 除外したメール(m3)は記録し、次回以降は取得し直さない
    const skipped = await prisma.skippedMessage.findMany({ where: { userId } });
    expect(skipped.map((x) => x.gmailMessageId)).toEqual(["m3"]);
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
    expect(r.sync?.remaining).toBe(1);
    expect(r.sync?.ingested).toBe(0);
    expect(r.process?.deferred ?? 0).toBe(0);
    const mid = await prisma.googleAccount.findUniqueOrThrow({ where: { userId } });
    expect(mid.lastSyncedAt?.getTime()).toBe(before.lastSyncedAt?.getTime());

    const r2 = await runTick(userId, deps());
    expect(r2.sync?.ingested).toBe(1);
    expect(r2.process?.processed).toBe(1);
  });

  it("一斉配信でも担当者のアドレスは AI で判定し、no-reply は判定せずに除外する", async () => {
    const bulk = [{ name: "List-Unsubscribe", value: "<mailto:unsubscribe@example.com>" }];
    box.messages.push(
      mail({ id: "m9", threadId: "t7", from: `田中 <tanaka@${THIRD_DOMAIN}>`, subject: "【案件のご紹介】React案件", body: "新着案件です", minutesAgo: 30, extraHeaders: bulk }),
      mail({ id: "m10", threadId: "t8", from: "お知らせ <noreply@service.example.com>", subject: "お知らせ", body: "キャンペーン", minutesAgo: 20, extraHeaders: bulk }),
    );
    const checksBefore = ai.calls.checkSender;

    const r = await runTick(userId, deps());
    expect(r.errors).toEqual([]);
    expect(r.sync?.ingested).toBe(1);
    expect(r.sync?.skipped).toBe(1);
    expect(r.sync?.newAgents).toBe(1);
    expect(ai.calls.checkSender - checksBefore).toBe(1); // m9 だけ AI で判定

    const agent = await prisma.agent.findFirst({ where: { userId, domains: { has: THIRD_DOMAIN } } });
    expect(agent).not.toBeNull();
    const verdict = await prisma.senderVerdict.findUniqueOrThrow({ where: { userId_email: { userId, email: "noreply@service.example.com" } } });
    expect(verdict.kind).toBe("NOT_AGENT");
    expect(verdict.reason).toBe("自動送信または no-reply のアドレス");
  });

  it("同期位置を戻しても、取り込み済みと除外済みのメールは取得し直さない", async () => {
    await prisma.googleAccount.update({ where: { userId }, data: { lastSyncedAt: null } });
    box.fetched.length = 0;

    const r = await runTick(userId, deps());
    expect(r.errors).toEqual([]);
    expect(r.sync?.listed).toBe(box.messages.length);
    expect(r.sync?.fetched).toBe(0);
    expect(box.fetched).toEqual([]);
  });

  it("利用上限のエラーは待ってやり直し、続くときは飛ばさずに次回へ回す", async () => {
    // 2回失敗してから成功する(同じ同期の中でやり直す)
    box.messages.push(mail({ id: "m11", threadId: "t9", from: `佐藤 <sato@${AGENT_DOMAIN}>`, subject: "面談日程のご相談", body: "日程はいかがでしょうか", minutesAgo: 4 }));
    box.rateLimited.set("m11", 2);
    const r1 = await runTick(userId, deps());
    expect(r1.errors).toEqual([]);
    expect(r1.sync?.ingested).toBe(1);

    // やり直しの回数を超えて失敗する
    box.messages.push(mail({ id: "m12", threadId: "t10", from: `佐藤 <sato@${AGENT_DOMAIN}>`, subject: "スキルシートのお願い", body: "ご送付ください", minutesAgo: 3 }));
    box.rateLimited.set("m12", 4);
    const before = await prisma.googleAccount.findUniqueOrThrow({ where: { userId } });
    const r2 = await runTick(userId, deps());
    expect(r2.sync?.ingested).toBe(0);
    expect(r2.sync?.remaining).toBe(1);
    expect(r2.sync?.errors.join()).toContain("Quota exceeded");
    const mid = await prisma.googleAccount.findUniqueOrThrow({ where: { userId } });
    expect(mid.lastSyncedAt?.getTime()).toBe(before.lastSyncedAt?.getTime());
    expect(mid.lastSyncError).toContain("Quota exceeded");
    expect(await prisma.skippedMessage.count({ where: { userId, gmailMessageId: "m12" } })).toBe(0);

    // 次回の同期で取り込む
    const r3 = await runTick(userId, deps());
    expect(r3.sync?.ingested).toBe(1);
    expect(await prisma.message.count({ where: { gmailMessageId: "m12" } })).toBe(1);
    const after = await prisma.googleAccount.findUniqueOrThrow({ where: { userId } });
    expect(after.lastSyncError).toBeNull();
  });

  it("受信から7日以上経ったメールは分類と案件の登録だけ行い、返信案は作らない", async () => {
    box.messages.push(
      mail({ id: "m13", threadId: "t11", from: `佐藤 <sato@${AGENT_DOMAIN}>`, subject: "【案件のご紹介】古い案件", body: "ご紹介です", minutesAgo: 8 * 24 * 60 }),
    );
    const draftsBefore = ai.calls.draft;

    const r = await runTick(userId, deps());
    expect(r.errors).toEqual([]);
    expect(r.sync?.ingested).toBe(1);
    expect(r.process?.noReply).toBe(1);
    expect(ai.calls.draft).toBe(draftsBefore);

    const message = await prisma.message.findFirstOrThrow({ where: { gmailMessageId: "m13" }, include: { thread: { include: { replies: true } } } });
    expect(message.processingStatus).toBe("PROCESSED");
    expect(message.category).toBe("JOB_PROPOSAL");
    expect(message.thread.replies).toHaveLength(0);
    const log = await prisma.activityLog.findFirst({ where: { userId, entityId: message.id, type: "reply.skipped" } });
    expect(log?.message).toContain("7 日以上経っています");
  });

  it("取り込み範囲を広げたときは範囲全体を一覧し直し、終わったら前回以降の取得に戻る", async () => {
    await prisma.googleAccount.update({ where: { userId }, data: { syncedLookbackDays: 7 } });
    box.queries.length = 0;

    const r1 = await runTick(userId, deps());
    expect(r1.errors).toEqual([]);
    expect(box.queries.at(-1)).toContain("newer_than:30d");
    const account = await prisma.googleAccount.findUniqueOrThrow({ where: { userId } });
    expect(account.syncedLookbackDays).toBe(30);

    await runTick(userId, deps());
    expect(box.queries.at(-1)).toMatch(/after:\d+/);
  });

  it("旧バージョンが一斉配信として除外した送信者は、AI で判定し直す", async () => {
    const email = `yamamoto@${FOURTH_DOMAIN}`;
    await prisma.senderVerdict.create({
      data: { userId, email, domain: FOURTH_DOMAIN, kind: "NOT_AGENT", reason: "一斉配信または自動送信アドレス" },
    });
    box.messages.push(
      mail({
        id: "m14",
        threadId: "t12",
        from: `山本 <${email}>`,
        subject: "【案件のご紹介】Python案件",
        body: "新着案件です",
        minutesAgo: 2,
        extraHeaders: [{ name: "List-Unsubscribe", value: "<mailto:unsubscribe@example.com>" }],
      }),
    );
    const checksBefore = ai.calls.checkSender;

    const r = await runTick(userId, deps());
    expect(r.errors).toEqual([]);
    expect(r.sync?.ingested).toBe(1);
    expect(ai.calls.checkSender - checksBefore).toBe(1);
    const verdict = await prisma.senderVerdict.findUniqueOrThrow({ where: { userId_email: { userId, email } } });
    expect(verdict.kind).toBe("AGENT");
  });

  it("Anthropic API キーが無効なときは、メールを未処理のまま残し、キーを直した後に処理する", async () => {
    ai.control.invalidKey = true;
    // 既知のエージェントのメールは、送信者の判定なしで取り込まれ、分析で失敗する
    box.messages.push(mail({ id: "m15", threadId: "t13", from: `佐藤 <sato@${AGENT_DOMAIN}>`, subject: "単価のご相談", body: "ご相談です", minutesAgo: 1 }));
    const r1 = await runTick(userId, deps());
    expect(r1.sync?.ingested).toBe(1);
    expect(r1.process?.haltedBy).toContain("Anthropic API キーが無効です");
    expect((await prisma.message.findFirstOrThrow({ where: { gmailMessageId: "m15" } })).processingStatus).toBe("PENDING");
    expect((await prisma.googleAccount.findUniqueOrThrow({ where: { userId } })).lastSyncError).toContain("Anthropic API キーが無効です");

    // 未知の送信者の判定で失敗した場合は、そこで同期を止めて次回に回す
    box.messages.push(mail({ id: "m16", threadId: "t14", from: "新規 <new@fifth.example.jp>", subject: "ご挨拶", body: "はじめまして", minutesAgo: 0 }));
    const r2 = await runTick(userId, deps());
    expect(r2.sync?.remaining).toBe(1);
    expect(r2.sync?.errors.join()).toContain("Anthropic API キーが無効です");
    expect(await prisma.skippedMessage.count({ where: { userId, gmailMessageId: "m16" } })).toBe(0);

    // キーを直すと、次の定期処理で続きが進む
    ai.control.invalidKey = false;
    const r3 = await runTick(userId, deps());
    expect(r3.errors).toEqual([]);
    expect(r3.process?.haltedBy).toBeNull();
    expect((await prisma.message.findFirstOrThrow({ where: { gmailMessageId: "m15" } })).processingStatus).toBe("PROCESSED");
    expect(await prisma.skippedMessage.count({ where: { userId, gmailMessageId: "m16" } })).toBe(1);
    expect((await prisma.googleAccount.findUniqueOrThrow({ where: { userId } })).lastSyncError).toBeNull();
  });
});
