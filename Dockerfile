# syntax=docker/dockerfile:1

FROM node:20-alpine AS base

# ─── Dependencies ────────────────────────────────────────────────────────
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ─── Build ───────────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Next.js telemetry off during build (optional, keeps logs clean)
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ─── Runtime ─────────────────────────────────────────────────────────────
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Non-root user for security
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json

# Next.js standalone output would be ideal, but next.config.ts doesn't set
# output: "standalone" currently, so we copy the full build + node_modules
# instead. (Could optimize later by adding output: "standalone" to
# next.config.ts and switching this Dockerfile to copy only .next/standalone.)
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules

# Maintenance scripts (npm run check:llm) need their TypeScript sources at
# runtime — run from the Coolify terminal, so they're tested from the same
# server/network the app uses. Not used by `next start`.
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/services/mock-1c ./services/mock-1c

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["npm", "start"]
