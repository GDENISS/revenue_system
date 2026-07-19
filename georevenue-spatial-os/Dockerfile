# GeoRevenue Spatial OS — Next.js frontend
FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# NEXT_PUBLIC_* vars are inlined into the JS bundle at BUILD time, so they
# must be passed as build args (see docker-compose.yml), not runtime env.
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_ARCGIS_PORTAL_URL=https://www.arcgis.com
ARG NEXT_PUBLIC_ARCGIS_APP_ID=
ARG NEXT_PUBLIC_ARCGIS_API_KEY=
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_ARCGIS_PORTAL_URL=$NEXT_PUBLIC_ARCGIS_PORTAL_URL \
    NEXT_PUBLIC_ARCGIS_APP_ID=$NEXT_PUBLIC_ARCGIS_APP_ID \
    NEXT_PUBLIC_ARCGIS_API_KEY=$NEXT_PUBLIC_ARCGIS_API_KEY \
    NEXT_TELEMETRY_DISABLED=1

COPY . .
RUN pnpm build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
USER node
EXPOSE 3000
CMD ["node", "server.js"]
