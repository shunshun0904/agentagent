import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as {
  __agentagentPrisma?: PrismaClient;
};

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL が設定されていません");
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

/** Prisma Client のシングルトン(初回アクセス時に生成) */
export function getPrisma(): PrismaClient {
  if (!globalForPrisma.__agentagentPrisma) {
    globalForPrisma.__agentagentPrisma = createPrismaClient();
  }
  return globalForPrisma.__agentagentPrisma;
}

/**
 * 遅延初期化される Prisma Client。
 * ビルド時など DATABASE_URL が無い状況でモジュールを読み込んでも失敗しない。
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const client = getPrisma();
    const value = Reflect.get(client, prop, client);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
