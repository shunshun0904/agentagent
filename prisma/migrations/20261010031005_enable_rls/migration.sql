-- 行レベルセキュリティ(RLS)を全テーブルで有効にする。
--
-- Supabase では public スキーマのテーブルが Data API(PostgREST)から参照できる状態になる。
-- RLS を有効にしてポリシーを作らないことで、Data API(anon / authenticated ロール)からの
-- 読み書きをすべて拒否する。
-- アプリと Prisma のマイグレーションはテーブル所有者(postgres)として接続するため、RLS の影響を受けない。
-- Supabase 以外の PostgreSQL でもこのマイグレーションは無害。
--
-- 今後テーブルを追加するマイグレーションでも、同じく RLS を有効にすること。

ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Session" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GoogleAccount" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Profile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReplyPolicy" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Agent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Contact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SenderVerdict" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Thread" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Message" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Reply" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Opportunity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ActivityLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JobLock" ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS "_prisma_migrations" ENABLE ROW LEVEL SECURITY;
