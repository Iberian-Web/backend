FROM node:24-slim AS base
WORKDIR /app
RUN corepack enable

# ── deps ─────────────────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json ./
COPY pnpm-lock.yaml ./
COPY pnpm-workspace.yaml ./
COPY prisma ./prisma
RUN pnpm install --ignore-scripts=false

# ── build ────────────────────────────────────────────────────────────────────
FROM deps AS build
COPY . .
RUN DATABASE_URL="postgresql://user:pass@localhost:5432/db" pnpm exec prisma generate
RUN pnpm run build

# ── runtime ──────────────────────────────────────────────────────────────────
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY package.json ./

EXPOSE 3001
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && node dist/index.js"]