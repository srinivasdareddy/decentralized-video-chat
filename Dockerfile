# syntax=docker/dockerfile:1

ARG NODE_VERSION=24

# All dependencies, for building the web client.
FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM deps AS build
COPY . .
RUN npm run build

# Only what the server needs at runtime.
FROM node:${NODE_VERSION}-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

FROM node:${NODE_VERSION}-alpine
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY package.json LICENSE ./
COPY shared ./shared
COPY server ./server
COPY --from=build /app/build/client ./build/client

USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT}/healthz`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
# Node runs the TypeScript server directly; no compile step.
CMD ["node", "server/index.ts"]
