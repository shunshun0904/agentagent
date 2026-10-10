import { describe, expect, it } from "vitest";
import { buildPoolConfig, stripConnectionParams } from "@/lib/db";

const URL_POOLER = "postgresql://postgres.abc:pw@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true&sslmode=require";

describe("stripConnectionParams", () => {
  it("SSL と pgbouncer のパラメータを取り除く", () => {
    const stripped = stripConnectionParams(URL_POOLER);
    expect(stripped).not.toContain("sslmode");
    expect(stripped).not.toContain("pgbouncer");
    expect(stripped).toContain("pooler.supabase.com:6543/postgres");
  });
});

describe("buildPoolConfig", () => {
  it("DATABASE_URL が無ければエラー", () => {
    expect(() => buildPoolConfig({} as NodeJS.ProcessEnv)).toThrow("DATABASE_URL");
  });

  it("no-verify は暗号化するが証明書を検証しない", () => {
    const config = buildPoolConfig({ DATABASE_URL: URL_POOLER, DATABASE_SSL: "no-verify" } as unknown as NodeJS.ProcessEnv);
    expect(config.ssl).toEqual({ rejectUnauthorized: false });
    expect(config.connectionString).not.toContain("sslmode");
    expect(config.max).toBe(5);
  });

  it("verify は CA 証明書が必須", () => {
    expect(() => buildPoolConfig({ DATABASE_URL: URL_POOLER, DATABASE_SSL: "verify" } as unknown as NodeJS.ProcessEnv)).toThrow(
      "DATABASE_CA_CERT",
    );
    const config = buildPoolConfig({
      DATABASE_URL: URL_POOLER,
      DATABASE_SSL: "verify",
      DATABASE_CA_CERT: "-----BEGIN CERTIFICATE-----\nAAA\n-----END CERTIFICATE-----",
    } as unknown as NodeJS.ProcessEnv);
    expect(config.ssl).toMatchObject({ rejectUnauthorized: true });
  });

  it("disable は TLS を使わない", () => {
    const config = buildPoolConfig({ DATABASE_URL: "postgresql://u:p@localhost:5432/db", DATABASE_SSL: "disable" } as unknown as NodeJS.ProcessEnv);
    expect(config.ssl).toBe(false);
  });

  it("未設定なら接続文字列に従い、pgbouncer だけ取り除く", () => {
    const config = buildPoolConfig({ DATABASE_URL: URL_POOLER, DATABASE_POOL_MAX: "3" } as unknown as NodeJS.ProcessEnv);
    expect(config.ssl).toBeUndefined();
    expect(config.connectionString).toContain("sslmode=require");
    expect(config.connectionString).not.toContain("pgbouncer");
    expect(config.max).toBe(3);
  });

  it("不正な DATABASE_SSL はエラー", () => {
    expect(() => buildPoolConfig({ DATABASE_URL: URL_POOLER, DATABASE_SSL: "maybe" } as unknown as NodeJS.ProcessEnv)).toThrow(
      "DATABASE_SSL",
    );
  });
});
