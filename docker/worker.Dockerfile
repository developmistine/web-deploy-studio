# syntax=docker/dockerfile:1.7
# Deploy Studio deployment worker. The ONLY component that talks to a Docker API — and only through
# docker-socket-proxy (DOCKER_HOST=tcp://docker-socket-proxy:2375). Runs as non-root.
FROM node:24-alpine
RUN apk add --no-cache docker-cli docker-cli-buildx
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts && npm rebuild prisma @prisma/engines esbuild
COPY prisma ./prisma
COPY prisma.config.ts tsconfig.json ./
COPY src ./src
COPY worker ./worker
COPY infra/site-template ./infra/site-template
COPY infra/traefik/dynamic/00-infra.yml ./infra/traefik/dynamic/00-infra.yml
RUN DATABASE_URL="mysql://build:build@localhost:3306/build" npx prisma generate
ENV NODE_ENV=production SITE_TEMPLATE_DIR=/app/infra/site-template
# Mount points for the artifact + routes volumes (fresh named volumes inherit uid 1000 ownership).
RUN mkdir -p /data/storage /data/routes && chown node:node /data/storage /data/routes && chmod 0750 /data/storage && chmod 0755 /data/routes
USER node
ENV TSX_DISABLE_CACHE=1 DOCKER_CONFIG=/tmp/.docker
CMD ["node", "--import", "tsx", "worker/src/main.ts"]
