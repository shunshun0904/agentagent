-- AlterTable
ALTER TABLE "ReplyPolicy" ADD COLUMN     "excludedSenders" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- 初期値: レバテックダイレクト(転職向けのスカウト)はフリーランスエージェントではないため除外する。
-- 設定画面の「除外する送信者」で変更できる
UPDATE "ReplyPolicy" SET "excludedSenders" = ARRAY['levtech-direct@levtech.jp']::TEXT[];
