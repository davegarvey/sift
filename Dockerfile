# Multi-stage build:
#   1. Build the static assets with Node.
#   2. Serve with Bun in a slim image.
FROM node:24-slim AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

FROM oven/bun:1.1-slim AS runtime
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server
COPY --from=builder /app/src ./src
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

LABEL org.opencontainers.image.title="Sift"
LABEL org.opencontainers.image.description="A simple, slick, browser-first RSS reader."

ENV PORT=8787
ENV SIFT_DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 8787
CMD ["bun", "server/bun.ts"]
