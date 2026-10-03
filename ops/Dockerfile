# The Node pin matches the Phase 8 runtime baseline; all installs honor the lockfile.
FROM node:22.23.2-bookworm-slim AS toolchain
RUN npm install --global pnpm@11.24.0
WORKDIR /app

FROM toolchain AS build
COPY . .
RUN pnpm install --frozen-lockfile
ARG VITE_API_ORIGIN
ARG VITE_WS_ORIGIN
RUN test -n "$VITE_API_ORIGIN" && test -n "$VITE_WS_ORIGIN" && pnpm build
RUN node ops/generate-security-headers.mjs && node apps/api/scripts/check-public-secrets.mjs

FROM toolchain AS production-dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/document-model/package.json ./packages/document-model/package.json
COPY packages/fixtures/package.json ./packages/fixtures/package.json
COPY packages/export/package.json ./packages/export/package.json
RUN pnpm install --prod --frozen-lockfile --ignore-scripts

FROM node:22.23.2-bookworm-slim AS api
WORKDIR /app
ENV NODE_ENV=production
COPY --from=production-dependencies --chown=node:node /app /app
COPY --from=build --chown=node:node /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=node:node /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=build --chown=node:node /app/packages/document-model/dist ./packages/document-model/dist
COPY --from=build --chown=node:node /app/packages/fixtures/dist ./packages/fixtures/dist
COPY --from=build --chown=node:node /app/packages/export/dist ./packages/export/dist
COPY --chown=node:node ops/load-secrets.mjs ./ops/load-secrets.mjs
USER node
EXPOSE 3000
STOPSIGNAL SIGTERM
CMD ["node", "ops/load-secrets.mjs"]

FROM caddy:2.11.6-alpine AS web
COPY --from=build /app/apps/web/dist /srv
COPY --from=build /app/ops/security-headers.caddy /etc/caddy/security-headers.caddy
COPY ops/Caddyfile /etc/caddy/Caddyfile
