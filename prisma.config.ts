import "dotenv/config";
import { defineConfig } from "prisma/config";

/**
 * Prisma CLI(マイグレーション)の設定。
 * マイグレーションは接続プールのトランザクションモードを経由できないため、
 * DIRECT_URL(Supabase ではセッションモード、ポート 5432)を優先して使う。
 * アプリ本体の接続は src/lib/db.ts が DATABASE_URL を使う。
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DIRECT_URL"] ?? process.env["DATABASE_URL"],
  },
});
