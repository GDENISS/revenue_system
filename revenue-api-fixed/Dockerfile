# Revenue API — Fastify + Postgres
FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY migrations ./migrations
COPY src ./src
# PDFs are written to /app/generated/notices — mounted as a volume in compose
RUN mkdir -p generated/notices && chown -R node:node /app
USER node
EXPOSE 8080
# Migrations are idempotent (IF NOT EXISTS / ON CONFLICT guards), so they run
# on every start; exec keeps the server as PID 1 for clean SIGTERM handling.
CMD ["sh", "-c", "node migrations/run.js && exec node src/server.js"]
