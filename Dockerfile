# エージェントエージェント: Cloud Run 用のコンテナイメージ
# ビルド: docker build -t agentagent .
# 実行:   docker run -p 8080:8080 --env-file .env agentagent

FROM node:22-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
# Prisma のマイグレーションエンジンが OpenSSL を使う
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# 1. 依存関係のインストール(postinstall で Prisma Client を生成するためスキーマも必要)
FROM base AS deps
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund

# 2. アプリのビルド(.next/standalone を作る)
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# 3. 起動時のマイグレーション用 Prisma CLI(アプリ本体とは別に入れる)
FROM base AS migrate
WORKDIR /migrate
COPY docker/migrate/package.json ./
RUN npm install --omit=dev --no-audit --no-fund

# 4. 実行用イメージ
FROM base AS runner
ENV NODE_ENV=production \
    PORT=8080 \
    HOSTNAME=0.0.0.0
RUN groupadd --system --gid 1001 nodejs \
  && useradd --system --uid 1001 --gid nodejs --home /app nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

COPY --from=migrate --chown=nextjs:nodejs /migrate/node_modules ./migrate/node_modules
COPY --chown=nextjs:nodejs docker/migrate/package.json ./migrate/package.json
COPY --chown=nextjs:nodejs prisma.config.ts ./migrate/prisma.config.ts
COPY --chown=nextjs:nodejs prisma ./migrate/prisma
COPY --chown=nextjs:nodejs docker/entrypoint.sh ./entrypoint.sh

USER nextjs
EXPOSE 8080
# 実行権限に依存しないよう sh で起動する
CMD ["sh", "/app/entrypoint.sh"]
