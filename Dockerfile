# syntax=docker/dockerfile:1.6
ARG NODE_VERSION=20-slim

FROM node:${NODE_VERSION} AS deps
WORKDIR /app
# If you have .npmrc with production=true, override it:
ENV NPM_CONFIG_PRODUCTION=""
COPY package.json package-lock.json ./
# Force dev deps present for build step:
RUN npm ci --include=dev

FROM node:${NODE_VERSION} AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Sanity checks (keep while debugging):
# RUN ls -la node_modules/.bin && npx tsc --version && npx tsc-alias --version
RUN npm run build

FROM node:${NODE_VERSION} AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:${NODE_VERSION} AS runtime-base
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/migrations ./migrations
COPY --from=builder /app/install-ffmpeg.sh ./install-ffmpeg.sh

FROM runtime-base AS api
EXPOSE 4000
CMD ["node", "dist/index.js"]

FROM runtime-base AS worker
CMD ["node", "dist/worker.js"]
