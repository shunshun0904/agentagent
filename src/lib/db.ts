import type { PoolConfig } from "pg";
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as {
  __agentagentPrisma?: PrismaClient;
};

const SSL_PARAMS = ["sslmode", "ssl", "sslcert", "sslkey", "sslrootcert", "uselibpqcompat", "pgbouncer"];

/** 接続文字列から SSL 関連と Prisma 専用のパラメータを取り除く */
export function stripConnectionParams(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    for (const key of SSL_PARAMS) url.searchParams.delete(key);
    return url.toString();
  } catch {
    return connectionString;
  }
}

/**
 * pg のプール設定を組み立てる。
 * DATABASE_SSL:
 *   - "verify":    DATABASE_CA_CERT(PEM)で証明書を検証して TLS 接続する
 *   - "no-verify": TLS で暗号化するが証明書は検証しない(Supabase の既定の証明書は独自 CA のため)
 *   - "disable":   TLS を使わない(ローカル開発用)
 *   - 未設定:      接続文字列の指定に従う
 */
export function buildPoolConfig(env: NodeJS.ProcessEnv): PoolConfig {
  const raw = env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL が設定されていません");
  const max = Number(env.DATABASE_POOL_MAX ?? "5");
  const poolMax = Number.isFinite(max) && max > 0 ? Math.trunc(max) : 5;
  const mode = (env.DATABASE_SSL ?? "").trim().toLowerCase();

  const base: PoolConfig = {
    max: poolMax,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
  };

  switch (mode) {
    case "verify": {
      const ca = env.DATABASE_CA_CERT;
      if (!ca) throw new Error("DATABASE_SSL=verify には DATABASE_CA_CERT(PEM)が必要です");
      return { ...base, connectionString: stripConnectionParams(raw), ssl: { ca, rejectUnauthorized: true } };
    }
    case "no-verify":
      return { ...base, connectionString: stripConnectionParams(raw), ssl: { rejectUnauthorized: false } };
    case "disable":
      return { ...base, connectionString: stripConnectionParams(raw), ssl: false };
    case "":
      // Prisma 用の pgbouncer パラメータだけは取り除く(pg には不要)
      return { ...base, connectionString: removeParam(raw, "pgbouncer") };
    default:
      throw new Error(`DATABASE_SSL の値が不正です: ${mode}(verify / no-verify / disable のいずれか)`);
  }
}

function removeParam(connectionString: string, key: string): string {
  try {
    const url = new URL(connectionString);
    url.searchParams.delete(key);
    return url.toString();
  } catch {
    return connectionString;
  }
}

function createPrismaClient(): PrismaClient {
  const adapter = new PrismaPg(buildPoolConfig(process.env), {
    onPoolError: (err) => console.error("[db] 接続プールでエラーが発生しました", err),
  });
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
