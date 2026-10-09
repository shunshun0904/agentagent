import "dotenv/config";
import { prisma } from "@/lib/db";
import { DEFAULT_POLICY } from "@/lib/policy/defaults";
import { PROMPT_VERSION } from "@/lib/ai/client";

/**
 * デモデータの投入。
 * デモユーザー(demo@example.com)のデータを削除してから作り直す(何度実行してもよい)。
 * 会社名・人名・メールアドレスはすべて架空のものです。
 */

const DEMO_EMAIL = "demo@example.com";

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60_000);
}
function daysAgo(days: number, hour = 10): Date {
  const d = new Date(Date.now() - days * 86_400_000);
  d.setHours(hour, 15, 0, 0);
  return d;
}
function inMinutes(minutes: number): Date {
  return new Date(Date.now() + minutes * 60_000);
}

async function main() {
  const existing = await prisma.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (existing) {
    await prisma.user.delete({ where: { id: existing.id } });
  }

  const user = await prisma.user.create({ data: { email: DEMO_EMAIL, name: "山田 太郎" } });
  const userId = user.id;

  await prisma.profile.create({
    data: {
      userId,
      displayName: "山田 太郎",
      headline: "バックエンドエンジニア(Go / TypeScript)",
      yearsOfExperience: 9,
      skills: ["Go", "TypeScript", "Node.js", "PostgreSQL", "AWS", "Terraform", "Docker", "GraphQL"],
      summary:
        "SaaS 企業で API 設計・開発、インフラ構築(AWS)、チームリードを経験。直近3年はフリーランスとして EC・フィンテック領域のバックエンド開発に従事。",
      desiredRateMin: 85,
      desiredRateMax: 95,
      availabilityStatus: "LOOKING",
      availableFrom: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1),
      weeklyDays: "週5日(週4日も相談可)",
      workStyle: "REMOTE_ONLY",
      locations: ["東京都", "リモート"],
      ngConditions: "常駐のみの案件、SES の多重下請け、PHP 中心の案件、夜間保守",
      preferences: "モダンな技術スタック、少人数チーム、長期(6ヶ月以上)を希望。スタートアップ歓迎。",
      interviewAvailability: "平日 10:00〜12:00、または 16:00〜19:00(オンライン希望)",
      skillSheetUrl: "https://example.com/skillsheet-yamada.pdf",
      signature: "山田 太郎\nバックエンドエンジニア\nMail: demo@example.com",
      writingStyle: "丁寧だが簡潔。冗長な前置きは避け、要点を箇条書きで伝える。",
      styleSamples:
        "お世話になっております。山田です。\nご紹介ありがとうございます。以下の点を確認させてください。\n・リモート比率\n・契約期間の見込み\nお手数ですがよろしくお願いいたします。",
    },
  });

  await prisma.replyPolicy.create({
    data: {
      userId,
      ...DEFAULT_POLICY,
      customInstructions: "単価は希望レンジの下限(85万円)より低い提示には即答せず確認扱いにする。面談は原則オンラインを希望。",
    },
  });

  // --- エージェント・担当者(すべて架空) ---
  const techbridge = await prisma.agent.create({
    data: {
      userId,
      name: "株式会社テックブリッジ",
      domains: ["techbridge.example.jp"],
      website: "https://techbridge.example.jp",
      notes: "対応が早い。Go 案件が多い。担当の佐藤さんは条件交渉に柔軟。",
      status: "ACTIVE",
      rating: 5,
    },
  });
  const nextcareer = await prisma.agent.create({
    data: {
      userId,
      name: "株式会社ネクストキャリア",
      domains: ["nextcareer.example.jp"],
      website: "https://nextcareer.example.jp",
      notes: "案件数は多いが単価はやや低め。",
      status: "ACTIVE",
      rating: 3,
    },
  });
  const freeworks = await prisma.agent.create({
    data: {
      userId,
      name: "株式会社フリーワークス",
      domains: ["freeworks.example.jp"],
      notes: "大手クライアント案件が中心。契約まわりの連絡が多い。",
      status: "ACTIVE",
      rating: 4,
      requireApproval: true,
    },
  });
  const sato = await prisma.contact.create({
    data: { userId, agentId: techbridge.id, name: "佐藤 美咲", email: "sato@techbridge.example.jp", role: "キャリアアドバイザー", lastContactAt: minutesAgo(50) },
  });
  const tanaka = await prisma.contact.create({
    data: { userId, agentId: nextcareer.id, name: "田中 健", email: "tanaka@nextcareer.example.jp", role: "営業", lastContactAt: minutesAgo(130) },
  });
  const suzuki = await prisma.contact.create({
    data: { userId, agentId: freeworks.id, name: "鈴木 大輔", email: "suzuki@freeworks.example.jp", role: "エージェント", lastContactAt: daysAgo(1, 15) },
  });

  // --- スレッド 1: 案件紹介 → 自動返信を予約済み ---
  const t1 = await prisma.thread.create({
    data: {
      userId,
      agentId: techbridge.id,
      contactId: sato.id,
      gmailThreadId: "demo-thread-0001",
      subject: "【案件のご紹介】Go/TypeScript バックエンド開発(フルリモート・〜90万円)",
      snippet: "山田様 お世話になっております。テックブリッジの佐藤です。ご希望に近い案件が入りましたのでご紹介いたします。",
      status: "OPEN",
      lastCategory: "JOB_PROPOSAL",
      summary: "テックブリッジの佐藤氏から Go/TypeScript のフルリモート案件(80〜90万円)の紹介。興味を示し、契約期間とリモート比率、面談の流れを質問する返信を予約済み。",
      lastMessageAt: minutesAgo(50),
      lastInboundAt: minutesAgo(50),
    },
  });
  const m1 = await prisma.message.create({
    data: {
      threadId: t1.id,
      gmailMessageId: "demo-msg-0001",
      direction: "INBOUND",
      fromEmail: sato.email,
      fromName: sato.name,
      toEmails: [DEMO_EMAIL],
      subject: t1.subject,
      bodyText:
        "山田様\n\nお世話になっております。テックブリッジの佐藤です。\nご希望に近い案件が入りましたのでご紹介いたします。\n\n■案件概要\n・内容: EC プラットフォームのバックエンド API 開発(Go、一部 TypeScript)\n・単価: 80〜90万円/月(スキル見合い)\n・勤務地: フルリモート(月1回程度、東京オフィスでの MTG あり)\n・期間: 11月〜長期\n・必須スキル: Go 3年以上、PostgreSQL、AWS\n・歓迎: GraphQL、Terraform\n\nご興味がございましたら、面談日程の調整に進めさせていただきます。\nご検討のほどよろしくお願いいたします。\n\n佐藤 美咲\n株式会社テックブリッジ",
      snippet: "山田様 お世話になっております。テックブリッジの佐藤です。ご希望に近い案件が入りましたのでご紹介いたします。",
      sentAt: minutesAgo(50),
      rfcMessageId: "<demo-0001@techbridge.example.jp>",
      processingStatus: "PROCESSED",
      processedAt: minutesAgo(48),
      category: "JOB_PROPOSAL",
      confidence: 0.96,
      aiSummary: "Go/TypeScript の EC バックエンド案件(80〜90万円、フルリモート、11月〜長期)の紹介。興味があれば面談調整に進みたいとのこと。",
      needsReply: true,
      extracted: {
        category: "JOB_PROPOSAL",
        jobs: [{ title: "EC プラットフォーム バックエンド API 開発(Go)", fit_score: 88 }],
        questions_asked: ["ご興味があるか"],
        proposed_dates: [],
      },
    },
  });
  const o1 = await prisma.opportunity.create({
    data: {
      userId,
      agentId: techbridge.id,
      threadId: t1.id,
      sourceMessageId: m1.id,
      title: "EC プラットフォーム バックエンド API 開発(Go)",
      description: "EC プラットフォームのバックエンド API 開発。Go がメイン、一部 TypeScript。",
      rateMin: 80,
      rateMax: 90,
      rateText: "80〜90万円/月(スキル見合い)",
      period: "11月〜長期",
      startText: "11月〜",
      location: "フルリモート(月1回東京オフィス)",
      remotePolicy: "フルリモート",
      skills: ["Go", "PostgreSQL", "AWS", "GraphQL", "Terraform"],
      stage: "INTERESTED",
      fitScore: 88,
      fitReason: "必須スキルを満たし、単価レンジは希望(85〜95)と重なる。月1回の出社がフルリモート希望とややずれるため確認が必要。",
    },
  });
  await prisma.reply.create({
    data: {
      userId,
      threadId: t1.id,
      inReplyToMessageId: m1.id,
      subject: `Re: ${t1.subject}`,
      bodyText:
        "株式会社テックブリッジ\n佐藤様\n\nお世話になっております。山田です。\n案件のご紹介ありがとうございます。\n\n内容を拝見し、Go と PostgreSQL、AWS を中心とした構成は私の経験と合致しており、ぜひ前向きに検討したいと考えております。\n確認させていただきたい点が2点ございます。\n\n・契約期間の見込み(初回契約の長さと更新の想定)\n・月1回の東京オフィスでの MTG は固定でしょうか。オンライン参加の可否も伺えますと幸いです。\n\n面談のお話も、条件の確認ができ次第ぜひ進めさせていただければと思います。\n引き続きよろしくお願いいたします。\n\n山田 太郎\nバックエンドエンジニア\nMail: demo@example.com",
      status: "SCHEDULED",
      decision: "AUTO",
      decisionReasons: ["ポリシーの自動返信条件を満たしています"],
      commitments: ["express_interest"],
      riskFlags: [],
      confidence: 0.9,
      aiReasoning: "適合度が高い案件なので興味を示しつつ、プロフィールの希望(フルリモート、長期)に関わる不足情報を質問する内容にした。単価や日程には言及していない。",
      scheduledFor: inMinutes(35),
      modelId: "claude-opus-5-5",
      promptVersion: PROMPT_VERSION,
      usage: { analysis: { input_tokens: 2100, output_tokens: 420 }, draft: { input_tokens: 3300, output_tokens: 610 } },
    },
  });

  // --- スレッド 2: 面談日程調整 → 日時確定のため承認待ち ---
  const t2 = await prisma.thread.create({
    data: {
      userId,
      agentId: nextcareer.id,
      contactId: tanaka.id,
      gmailThreadId: "demo-thread-0002",
      subject: "Re: 【面談日程のご相談】フィンテック企業 API 開発案件",
      snippet: "山田様 先日はご検討いただきありがとうございます。クライアントより面談の候補日時をいただきました。",
      status: "NEEDS_ACTION",
      lastCategory: "INTERVIEW_SCHEDULING",
      summary: "ネクストキャリアの田中氏から、フィンテック企業の API 開発案件の面談候補日時(3枠)の提示。候補のうち1枠で確定する返信案が承認待ち。",
      lastMessageAt: minutesAgo(130),
      lastInboundAt: minutesAgo(130),
      lastOutboundAt: daysAgo(2, 11),
    },
  });
  await prisma.message.create({
    data: {
      threadId: t2.id,
      gmailMessageId: "demo-msg-0002a",
      direction: "INBOUND",
      fromEmail: tanaka.email,
      fromName: tanaka.name,
      toEmails: [DEMO_EMAIL],
      subject: "【案件のご紹介】フィンテック企業 API 開発案件",
      bodyText:
        "山田様\n\nお世話になっております。ネクストキャリアの田中です。\nフィンテック企業での決済 API 開発案件(TypeScript / Node.js、〜85万円、リモート中心・週1出社)をご紹介します。\nご興味があればクライアントとの面談を設定いたします。\n\n田中 健\n株式会社ネクストキャリア",
      snippet: "フィンテック企業での決済 API 開発案件をご紹介します。",
      sentAt: daysAgo(3, 14),
      rfcMessageId: "<demo-0002a@nextcareer.example.jp>",
      processingStatus: "PROCESSED",
      processedAt: daysAgo(3, 14),
      category: "JOB_PROPOSAL",
      confidence: 0.93,
      aiSummary: "決済 API 開発案件(TypeScript/Node.js、〜85万円、週1出社)の紹介。",
      needsReply: true,
    },
  });
  await prisma.message.create({
    data: {
      threadId: t2.id,
      gmailMessageId: "demo-msg-0002b",
      direction: "OUTBOUND",
      fromEmail: DEMO_EMAIL,
      fromName: "山田 太郎",
      toEmails: [tanaka.email],
      subject: "Re: 【案件のご紹介】フィンテック企業 API 開発案件",
      bodyText:
        "株式会社ネクストキャリア\n田中様\n\nお世話になっております。山田です。\nご紹介ありがとうございます。週1出社の点は許容範囲ですので、ぜひ面談をお願いできればと思います。\n単価については面談の中で改めてご相談させてください。\n\n山田 太郎",
      snippet: "ご紹介ありがとうございます。ぜひ面談をお願いできればと思います。",
      sentAt: daysAgo(2, 11),
      rfcMessageId: "<demo-0002b@mail.example.com>",
      processingStatus: "PROCESSED",
      processedAt: daysAgo(2, 11),
    },
  });
  const m2 = await prisma.message.create({
    data: {
      threadId: t2.id,
      gmailMessageId: "demo-msg-0002c",
      direction: "INBOUND",
      fromEmail: tanaka.email,
      fromName: tanaka.name,
      toEmails: [DEMO_EMAIL],
      subject: t2.subject,
      bodyText:
        "山田様\n\n先日はご検討いただきありがとうございます。\nクライアントより面談の候補日時をいただきましたので、ご都合の良い枠をお知らせください。\n\n・10月14日(火) 11:00〜12:00\n・10月15日(水) 17:00〜18:00\n・10月16日(木) 13:00〜14:00\n\nいずれもオンライン(Google Meet)を予定しております。\nお忙しいところ恐れ入りますが、明日中にご回答いただけますと幸いです。\n\n田中 健\n株式会社ネクストキャリア",
      snippet: "クライアントより面談の候補日時をいただきましたので、ご都合の良い枠をお知らせください。",
      sentAt: minutesAgo(130),
      rfcMessageId: "<demo-0002c@nextcareer.example.jp>",
      inReplyTo: "<demo-0002b@mail.example.com>",
      processingStatus: "PROCESSED",
      processedAt: minutesAgo(127),
      category: "INTERVIEW_SCHEDULING",
      confidence: 0.97,
      aiSummary: "面談候補日時3枠の提示。明日中の回答を希望。すべてオンライン。",
      needsReply: true,
      extracted: {
        category: "INTERVIEW_SCHEDULING",
        proposed_dates: ["10月14日(火) 11:00〜12:00", "10月15日(水) 17:00〜18:00", "10月16日(木) 13:00〜14:00"],
        deadline: "明日中",
      },
    },
  });
  await prisma.opportunity.create({
    data: {
      userId,
      agentId: nextcareer.id,
      threadId: t2.id,
      title: "フィンテック企業 決済 API 開発(TypeScript/Node.js)",
      rateMax: 85,
      rateText: "〜85万円",
      remotePolicy: "リモート中心・週1出社",
      skills: ["TypeScript", "Node.js"],
      stage: "INTERVIEW_SCHEDULING",
      fitScore: 72,
      fitReason: "技術は合致。単価上限が希望下限をやや下回り、週1出社がフルリモート希望と異なる。",
    },
  });
  await prisma.reply.create({
    data: {
      userId,
      threadId: t2.id,
      inReplyToMessageId: m2.id,
      subject: t2.subject,
      bodyText:
        "株式会社ネクストキャリア\n田中様\n\nお世話になっております。山田です。\n候補日時のご連絡ありがとうございます。\n\n以下の枠でお願いできればと思います。\n・10月14日(火) 11:00〜12:00\n\nオンライン(Google Meet)で問題ございません。当日の URL をお送りいただけますと幸いです。\n引き続きよろしくお願いいたします。\n\n山田 太郎\nバックエンドエンジニア\nMail: demo@example.com",
      status: "PENDING_APPROVAL",
      decision: "NEEDS_APPROVAL",
      decisionReasons: ["返信に承認が必要な内容が含まれます: confirm_date"],
      commitments: ["confirm_date"],
      riskFlags: ["日程を確定"],
      confidence: 0.85,
      aiReasoning: "面談可能な時間帯(平日 10〜12 時、16〜19 時)に合う 14 日 11:00 と 15 日 17:00 のうち、早い方を選んだ。日時の確定は本人確認が必要なため承認待ちにしている。",
      modelId: "claude-opus-5-5",
      promptVersion: PROMPT_VERSION,
    },
  });

  // --- スレッド 3: 状況確認 → 自動返信済み(相手待ち) ---
  const t3 = await prisma.thread.create({
    data: {
      userId,
      agentId: techbridge.id,
      contactId: sato.id,
      gmailThreadId: "demo-thread-0003",
      subject: "近況のご確認",
      snippet: "山田様 ご無沙汰しております。テックブリッジの佐藤です。現在のご状況をお伺いできればと思いご連絡しました。",
      status: "WAITING_THEM",
      lastCategory: "STATUS_CHECK",
      summary: "佐藤氏からの近況確認に対し、来月から稼働可能であることと希望条件を自動返信済み。",
      lastMessageAt: daysAgo(4, 11),
      lastInboundAt: daysAgo(4, 9),
      lastOutboundAt: daysAgo(4, 11),
    },
  });
  const m3 = await prisma.message.create({
    data: {
      threadId: t3.id,
      gmailMessageId: "demo-msg-0003a",
      direction: "INBOUND",
      fromEmail: sato.email,
      fromName: sato.name,
      toEmails: [DEMO_EMAIL],
      subject: t3.subject,
      bodyText:
        "山田様\n\nご無沙汰しております。テックブリッジの佐藤です。\n現在のご状況をお伺いできればと思いご連絡しました。\n次の案件をお探しでしたら、ご希望の条件(単価、稼働開始時期、リモートの希望など)を教えていただけますと幸いです。\n\n佐藤 美咲\n株式会社テックブリッジ",
      snippet: "現在のご状況をお伺いできればと思いご連絡しました。",
      sentAt: daysAgo(4, 9),
      rfcMessageId: "<demo-0003a@techbridge.example.jp>",
      processingStatus: "PROCESSED",
      processedAt: daysAgo(4, 9),
      category: "STATUS_CHECK",
      confidence: 0.95,
      aiSummary: "近況と希望条件の確認。",
      needsReply: true,
    },
  });
  await prisma.message.create({
    data: {
      threadId: t3.id,
      gmailMessageId: "demo-msg-0003b",
      direction: "OUTBOUND",
      fromEmail: DEMO_EMAIL,
      fromName: "山田 太郎",
      toEmails: [sato.email],
      subject: `Re: ${t3.subject}`,
      bodyText:
        "株式会社テックブリッジ\n佐藤様\n\nお世話になっております。山田です。\nご連絡ありがとうございます。\n\n現在の案件が今月末で終了予定のため、来月初めから稼働可能です。\n希望条件は以下のとおりです。\n・技術: Go または TypeScript を中心としたバックエンド開発\n・稼働: 週5日(週4日も相談可)、フルリモート希望\n・期間: 6ヶ月以上の長期\n\n単価については案件の内容を踏まえてご相談できればと思います。\n良い案件がございましたらご紹介いただけますと幸いです。\n\n山田 太郎\nバックエンドエンジニア\nMail: demo@example.com",
      snippet: "現在の案件が今月末で終了予定のため、来月初めから稼働可能です。",
      sentAt: daysAgo(4, 11),
      rfcMessageId: "<demo-0003b@mail.example.com>",
      inReplyTo: "<demo-0003a@techbridge.example.jp>",
      processingStatus: "PROCESSED",
      processedAt: daysAgo(4, 11),
    },
  });
  await prisma.reply.create({
    data: {
      userId,
      threadId: t3.id,
      inReplyToMessageId: m3.id,
      subject: `Re: ${t3.subject}`,
      bodyText: "(送信済み。本文はスレッドの送信メールを参照)",
      status: "SENT",
      decision: "AUTO",
      decisionReasons: ["ポリシーの自動返信条件を満たしています"],
      commitments: ["none"],
      riskFlags: [],
      confidence: 0.93,
      aiReasoning: "プロフィールの稼働開始可能日と希望条件をそのまま伝える内容のため自動送信とした。単価の数字は出していない。",
      scheduledFor: daysAgo(4, 11),
      sentAt: daysAgo(4, 11),
      sentGmailMessageId: "demo-msg-0003b",
      modelId: "claude-opus-5-5",
      promptVersion: PROMPT_VERSION,
    },
  });

  // --- スレッド 4: 単価交渉 → 承認待ち ---
  const t4 = await prisma.thread.create({
    data: {
      userId,
      agentId: freeworks.id,
      contactId: suzuki.id,
      gmailThreadId: "demo-thread-0004",
      subject: "Re: 【大手物流企業】基幹システム刷新プロジェクト 単価のご相談",
      snippet: "山田様 面談のご対応ありがとうございました。クライアントより参画の意向をいただいております。",
      status: "NEEDS_ACTION",
      lastCategory: "RATE_NEGOTIATION",
      summary: "フリーワークスの鈴木氏から、面談通過と単価 80 万円での提示。希望下限 85 万円との差について確認する返信案が承認待ち。",
      lastMessageAt: daysAgo(1, 15),
      lastInboundAt: daysAgo(1, 15),
    },
  });
  const m4 = await prisma.message.create({
    data: {
      threadId: t4.id,
      gmailMessageId: "demo-msg-0004",
      direction: "INBOUND",
      fromEmail: suzuki.email,
      fromName: suzuki.name,
      toEmails: [DEMO_EMAIL],
      ccEmails: ["assist@freeworks.example.jp"],
      subject: t4.subject,
      bodyText:
        "山田様\n\n面談のご対応ありがとうございました。\nクライアントより参画の意向をいただいております。\n\n単価についてですが、クライアントの予算の都合で 80 万円/月 でのご提示となります。\nご希望より低い金額となり恐縮ですが、ご検討いただけますでしょうか。\n3ヶ月後の更新時に見直しの相談は可能とのことです。\n\n鈴木 大輔\n株式会社フリーワークス",
      snippet: "単価についてですが、クライアントの予算の都合で 80 万円/月 でのご提示となります。",
      sentAt: daysAgo(1, 15),
      rfcMessageId: "<demo-0004@freeworks.example.jp>",
      processingStatus: "PROCESSED",
      processedAt: daysAgo(1, 15),
      category: "RATE_NEGOTIATION",
      confidence: 0.98,
      aiSummary: "面談通過。単価 80 万円/月の提示(希望より低い)。3ヶ月後の更新時に見直し可能。",
      needsReply: true,
    },
  });
  await prisma.opportunity.create({
    data: {
      userId,
      agentId: freeworks.id,
      threadId: t4.id,
      sourceMessageId: m4.id,
      title: "大手物流企業 基幹システム刷新(Go マイクロサービス)",
      rateMin: 80,
      rateMax: 80,
      rateText: "80万円/月(3ヶ月後に見直し相談可)",
      period: "長期",
      location: "東京(リモート中心)",
      remotePolicy: "リモート中心",
      skills: ["Go", "Kubernetes", "AWS"],
      stage: "OFFER",
      fitScore: 70,
      fitReason: "単価が希望下限(85)を下回る。技術・期間は合致。",
      interviewAt: daysAgo(3, 14),
    },
  });
  await prisma.reply.create({
    data: {
      userId,
      threadId: t4.id,
      inReplyToMessageId: m4.id,
      subject: t4.subject,
      bodyText:
        "株式会社フリーワークス\n鈴木様\n\nお世話になっております。山田です。\n面談の調整と、参画の意向をお伝えいただきありがとうございます。\n\n単価の件、ご相談の内容は承知いたしました。\n率直に申し上げますと、現在の希望レンジは 85 万円/月 以上としており、今回のご提示との差について一度検討させてください。\n以下の点を確認させていただけますと判断しやすくなります。\n\n・3ヶ月後の見直しで想定される単価の目安\n・稼働条件(リモート比率、出社頻度)の最終確認\n\nお手数をおかけしますが、よろしくお願いいたします。\n\n山田 太郎\nバックエンドエンジニア\nMail: demo@example.com",
      status: "PENDING_APPROVAL",
      decision: "NEEDS_APPROVAL",
      decisionReasons: [
        "このエージェントは常に承認が必要な設定です",
        "カテゴリ「RATE_NEGOTIATION」は承認が必要です",
        "返信に承認が必要な内容が含まれます: share_rate",
      ],
      commitments: ["share_rate"],
      riskFlags: ["単価に言及", "条件交渉"],
      confidence: 0.78,
      aiReasoning: "本人の追加指示(下限より低い提示には即答しない)に従い、即答を避けつつ希望レンジを伝え、判断材料となる情報を質問する内容にした。単価の数字に言及するため承認が必要。",
      modelId: "claude-opus-5-5",
      promptVersion: PROMPT_VERSION,
    },
  });

  // --- スレッド 5: 一斉配信 → 返信なし ---
  const t5 = await prisma.thread.create({
    data: {
      userId,
      agentId: nextcareer.id,
      contactId: tanaka.id,
      gmailThreadId: "demo-thread-0005",
      subject: "【今週の新着案件 20 件】ネクストキャリア案件通信",
      snippet: "今週の新着案件をお届けします。",
      status: "CLOSED",
      lastCategory: "NEWSLETTER",
      lastMessageAt: daysAgo(2, 8),
      lastInboundAt: daysAgo(2, 8),
    },
  });
  await prisma.message.create({
    data: {
      threadId: t5.id,
      gmailMessageId: "demo-msg-0005",
      direction: "INBOUND",
      fromEmail: tanaka.email,
      fromName: tanaka.name,
      toEmails: [DEMO_EMAIL],
      subject: t5.subject,
      bodyText: "今週の新着案件をお届けします。\n\n1. Java 基幹システム保守(〜70万円)\n2. React フロントエンド(〜75万円)\n3. Python データ基盤(〜85万円)\n...\n\n※このメールは配信希望の方にお送りしています。",
      snippet: "今週の新着案件をお届けします。",
      sentAt: daysAgo(2, 8),
      rfcMessageId: "<demo-0005@nextcareer.example.jp>",
      processingStatus: "PROCESSED",
      processedAt: daysAgo(2, 8),
      category: "NEWSLETTER",
      confidence: 0.99,
      aiSummary: "新着案件の一斉配信メール。",
      needsReply: false,
    },
  });

  // --- スレッド 6: 資料依頼(未処理) ---
  const t6 = await prisma.thread.create({
    data: {
      userId,
      agentId: techbridge.id,
      contactId: sato.id,
      gmailThreadId: "demo-thread-0006",
      subject: "スキルシートのご提出のお願い",
      snippet: "山田様 クライアント提出用に最新のスキルシートをいただけますでしょうか。",
      status: "OPEN",
      lastMessageAt: minutesAgo(8),
      lastInboundAt: minutesAgo(8),
    },
  });
  await prisma.message.create({
    data: {
      threadId: t6.id,
      gmailMessageId: "demo-msg-0006",
      direction: "INBOUND",
      fromEmail: sato.email,
      fromName: sato.name,
      toEmails: [DEMO_EMAIL],
      subject: t6.subject,
      bodyText:
        "山田様\n\nお世話になっております。テックブリッジの佐藤です。\nクライアント提出用に最新のスキルシートをいただけますでしょうか。\n前回いただいたものから更新があれば、そちらを反映したものをお願いいたします。\n\n佐藤 美咲\n株式会社テックブリッジ",
      snippet: "クライアント提出用に最新のスキルシートをいただけますでしょうか。",
      sentAt: minutesAgo(8),
      rfcMessageId: "<demo-0006@techbridge.example.jp>",
      processingStatus: "PENDING",
    },
  });

  // --- スレッド 7: 選考結果(見送り) → 承認待ち ---
  const t7 = await prisma.thread.create({
    data: {
      userId,
      agentId: nextcareer.id,
      contactId: tanaka.id,
      gmailThreadId: "demo-thread-0007",
      subject: "【選考結果のご連絡】SaaS 企業 バックエンド開発案件",
      snippet: "山田様 先日ご面談いただいた案件について、クライアントより結果の連絡がございました。",
      status: "NEEDS_ACTION",
      lastCategory: "SELECTION_RESULT",
      summary: "SaaS 企業案件は他候補者で決定となり見送り。感謝と今後の案件紹介を依頼する返信案が承認待ち。",
      lastMessageAt: daysAgo(1, 17),
      lastInboundAt: daysAgo(1, 17),
    },
  });
  const m7 = await prisma.message.create({
    data: {
      threadId: t7.id,
      gmailMessageId: "demo-msg-0007",
      direction: "INBOUND",
      fromEmail: tanaka.email,
      fromName: tanaka.name,
      toEmails: [DEMO_EMAIL],
      subject: t7.subject,
      bodyText:
        "山田様\n\nお世話になっております。ネクストキャリアの田中です。\n先日ご面談いただいた SaaS 企業の案件について、クライアントより結果の連絡がございました。\n\n大変残念ながら、今回は他の候補者の方で決定となりました。\nスキル面では高い評価をいただいておりましたので、別の案件を改めてご紹介させてください。\n\n田中 健\n株式会社ネクストキャリア",
      snippet: "大変残念ながら、今回は他の候補者の方で決定となりました。",
      sentAt: daysAgo(1, 17),
      rfcMessageId: "<demo-0007@nextcareer.example.jp>",
      processingStatus: "PROCESSED",
      processedAt: daysAgo(1, 17),
      category: "SELECTION_RESULT",
      confidence: 0.97,
      aiSummary: "面談した SaaS 企業案件は他候補者で決定(見送り)。別案件を紹介したい意向。",
      needsReply: true,
    },
  });
  await prisma.opportunity.create({
    data: {
      userId,
      agentId: nextcareer.id,
      threadId: t7.id,
      sourceMessageId: m7.id,
      title: "SaaS 企業 バックエンド開発(TypeScript)",
      rateText: "〜80万円",
      skills: ["TypeScript", "AWS"],
      stage: "LOST",
      fitScore: 65,
      interviewAt: daysAgo(5, 13),
    },
  });
  await prisma.reply.create({
    data: {
      userId,
      threadId: t7.id,
      inReplyToMessageId: m7.id,
      subject: `Re: ${t7.subject}`,
      bodyText:
        "株式会社ネクストキャリア\n田中様\n\nお世話になっております。山田です。\n結果のご連絡ありがとうございます。\n\n今回はご縁がありませんでしたが、面談の機会をいただけたこと、また高い評価をお伝えいただいたことに感謝しております。\n別の案件のご紹介もぜひお願いできればと思います。引き続きよろしくお願いいたします。\n\n山田 太郎\nバックエンドエンジニア\nMail: demo@example.com",
      status: "PENDING_APPROVAL",
      decision: "NEEDS_APPROVAL",
      decisionReasons: ["カテゴリ「SELECTION_RESULT」は承認が必要です"],
      commitments: ["none"],
      riskFlags: [],
      confidence: 0.92,
      aiReasoning: "見送り連絡への定型的な感謝の返信。選考結果カテゴリはポリシーで承認対象のため承認待ちにした。",
      modelId: "claude-opus-5-5",
      promptVersion: PROMPT_VERSION,
    },
  });

  // --- 活動ログ ---
  const logs: { type: string; message: string; minutesAgo: number }[] = [
    { type: "auth.login", message: "demo@example.com がログインしました", minutesAgo: 60 * 24 * 5 },
    { type: "sync.completed", message: "Gmail 同期: 3 件取り込み、12 件除外、新規エージェント 1 件", minutesAgo: 60 * 24 * 4 + 30 },
    { type: "reply.sent", message: "「Re: 近況のご確認」を sato@techbridge.example.jp に送信しました(自動)", minutesAgo: 60 * 24 * 4 },
    { type: "opportunity.created", message: "案件「フィンテック企業 決済 API 開発(TypeScript/Node.js)」を登録しました(適合度 72)", minutesAgo: 60 * 24 * 3 },
    { type: "reply.skipped", message: "「【今週の新着案件 20 件】ネクストキャリア案件通信」には返信しません: カテゴリ「NEWSLETTER」は返信しない設定です", minutesAgo: 60 * 24 * 2 },
    { type: "reply.needs_approval", message: "「Re: 【大手物流企業】基幹システム刷新プロジェクト 単価のご相談」への返信案が承認待ちです: カテゴリ「RATE_NEGOTIATION」は承認が必要です", minutesAgo: 60 * 24 },
    { type: "reply.needs_approval", message: "「【選考結果のご連絡】SaaS 企業 バックエンド開発案件」への返信案が承認待ちです: カテゴリ「SELECTION_RESULT」は承認が必要です", minutesAgo: 60 * 23 },
    { type: "message.analyzed", message: "「Re: 【面談日程のご相談】フィンテック企業 API 開発案件」を「面談日程調整」に分類しました(確信度 97%)", minutesAgo: 128 },
    { type: "reply.needs_approval", message: "「Re: 【面談日程のご相談】フィンテック企業 API 開発案件」への返信案が承認待ちです: 返信に承認が必要な内容が含まれます: confirm_date", minutesAgo: 127 },
    { type: "message.analyzed", message: "「【案件のご紹介】Go/TypeScript バックエンド開発(フルリモート・〜90万円)」を「案件紹介」に分類しました(確信度 96%)", minutesAgo: 49 },
    { type: "opportunity.created", message: "案件「EC プラットフォーム バックエンド API 開発(Go)」を登録しました(適合度 88)", minutesAgo: 49 },
    { type: "reply.scheduled", message: "「【案件のご紹介】Go/TypeScript バックエンド開発(フルリモート・〜90万円)」への返信を自動送信に予約しました", minutesAgo: 48 },
    { type: "sync.completed", message: "Gmail 同期: 1 件取り込み、4 件除外、新規エージェント 0 件", minutesAgo: 7 },
  ];
  for (const log of logs) {
    await prisma.activityLog.create({
      data: { userId, type: log.type, message: log.message, createdAt: minutesAgo(log.minutesAgo) },
    });
  }

  console.log(`デモデータを投入しました: user=${userId} (${DEMO_EMAIL})`);
  console.log(`案件: ${o1.title} ほか`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
