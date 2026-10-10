-- CreateTable
CREATE TABLE "SkippedMessage" (
    "userId" TEXT NOT NULL,
    "gmailMessageId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SkippedMessage_pkey" PRIMARY KEY ("userId","gmailMessageId")
);

-- CreateIndex
CREATE INDEX "SkippedMessage_createdAt_idx" ON "SkippedMessage"("createdAt");

-- AddForeignKey
ALTER TABLE "SkippedMessage" ADD CONSTRAINT "SkippedMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 他のテーブルと同じく、Supabase の Data API から読めないようにする
ALTER TABLE "SkippedMessage" ENABLE ROW LEVEL SECURITY;

-- 一斉配信のメールも AI で判定するように変えたため、ルールで除外した送信者の判定を消して判定し直す
DELETE FROM "SenderVerdict" WHERE "reason" = '一斉配信または自動送信アドレス';

-- 取り込みを済ませた過去の日数。既存のアカウントは未設定(NULL)になり、次回の同期で取り込み範囲(既定 30 日)全体を取り込み直す
ALTER TABLE "GoogleAccount" ADD COLUMN "syncedLookbackDays" INTEGER;
