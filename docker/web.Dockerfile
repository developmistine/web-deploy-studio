# syntax=docker/dockerfile:1.7
# Deploy Studio web (Next.js). Pin base images by digest in production.
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts && npm rebuild prisma @prisma/engines esbuild

FROM deps AS build
COPY . .
RUN DATABASE_URL="mysql://build:build@localhost:3306/build" npx prisma generate && npx next build

# One-shot migration job (has the Prisma CLI; uses the ds_migrate account).
FROM deps AS migrator
COPY prisma ./prisma
COPY prisma.config.ts tsconfig.json ./
COPY src/lib ./src/lib
COPY src/server/db.ts ./src/server/db.ts
RUN DATABASE_URL="mysql://build:build@localhost:3306/build" npx prisma generate
USER node

# Infra-only admin CLI (scripts/admin.ts): bootstrap the first administrator, incident response. Never a web entry
# point — run on demand with `docker compose --profile tools run --rm admin …` (DML-only runtime DB account).
FROM deps AS tools
COPY . .
RUN DATABASE_URL="mysql://build:build@localhost:3306/build" npx prisma generate
USER node
ENTRYPOINT ["node", "--import", "tsx", "scripts/admin.ts"]

# Minimal runtime: standalone server, non-root, no Docker CLI, no socket.
FROM node:24-alpine AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=root:root /app/.next/standalone ./
COPY --from=build --chown=root:root /app/.next/static ./.next/static
COPY --from=build --chown=root:root /app/public ./public
# Mount point for the private artifact volume; a fresh named volume inherits this ownership (uid 1000).
RUN mkdir -p /data/storage && chown node:node /data/storage && chmod 0750 /data/storage
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server.js"]
