# syntax=docker/dockerfile:1.7
# One Node runtime image for api, worker, mcp-bridge and the Shopify-shaped fixture server.
FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1
RUN corepack enable && corepack prepare pnpm@11.20.0 --activate
WORKDIR /src
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
COPY apps/worker ./apps/worker
COPY apps/mcp-bridge ./apps/mcp-bridge
COPY apps/web ./apps/web
COPY apps/landing ./apps/landing
# the landing page copies the supplied prototype stylesheet at build time; a missing file must fail the build, not be masked
COPY reference/prototype/styles.css ./reference/prototype/styles.css
COPY release/manifest.json ./release/manifest.json
COPY tests/package.json ./tests/package.json
RUN pnpm install --frozen-lockfile
RUN pnpm -r --filter './packages/**' run build && pnpm --filter @blackbox/api --filter @blackbox/worker --filter @blackbox/mcp-bridge run build \
 && pnpm --filter @blackbox/web run build && pnpm --filter @blackbox/landing run build
# reinstall production dependencies only (from the offline store); workspace packages stay linked by relative symlinks
RUN rm -rf node_modules apps/*/node_modules packages/*/node_modules tests/node_modules \
 && pnpm install --prod --frozen-lockfile --offline --ignore-scripts \
 && rm -rf apps/*/src packages/*/src apps/web/node_modules apps/landing/node_modules

FROM node:22-bookworm-slim AS runtime
ARG SERVICE_VERSION=0.1.0-dev
ENV NODE_ENV=production SERVICE_VERSION=$SERVICE_VERSION BLACKBOX_IN_CONTAINER=1 NODE_OPTIONS=--enable-source-maps
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates tini && rm -rf /var/lib/apt/lists/* \
 && groupadd -g 10001 blackbox && useradd -u 10001 -g blackbox -d /app -s /usr/sbin/nologin blackbox && mkdir -p /var/blackbox/data /var/blackbox/logs && chown -R blackbox:blackbox /var/blackbox
WORKDIR /app
COPY --from=build --chown=blackbox:blackbox /src/package.json /src/pnpm-workspace.yaml ./
COPY --from=build --chown=blackbox:blackbox /src/node_modules ./node_modules
COPY --from=build --chown=blackbox:blackbox /src/packages ./packages
COPY --from=build --chown=blackbox:blackbox /src/apps/api ./apps/api
COPY --from=build --chown=blackbox:blackbox /src/apps/worker ./apps/worker
COPY --from=build --chown=blackbox:blackbox /src/apps/mcp-bridge ./apps/mcp-bridge
COPY --from=build --chown=blackbox:blackbox /src/apps/web/dist ./web
COPY --from=build --chown=blackbox:blackbox /src/apps/landing/dist ./landing
COPY --chown=blackbox:blackbox fixtures/shopify-fixture-server ./fixture
COPY --chown=blackbox:blackbox GOLDEN-ORDER-TO-CASH.json ./fixtures/golden-order-to-cash.json
ENV MIGRATIONS_DIR=/app/packages/database/migrations FIXTURES_DIR=/app/fixtures WEB_DIST=/app/web LANDING_DIST=/app/landing
USER blackbox
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/api/dist/server.js"]
