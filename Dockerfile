# Stage 1: build Tailwind CSS
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json .
RUN npm install

COPY tailwind.config.js .
COPY src/input.css src/input.css
COPY src/public/index.html src/public/index.html

RUN npx tailwindcss -i src/input.css -o src/public/style.css --minify

# Stage 2: lean runtime image
FROM node:22-alpine
WORKDIR /app

# su-exec is used by the entrypoint to drop from root → node after fixing /data ownership
RUN apk add --no-cache su-exec

COPY package.json .
RUN npm install --omit=dev

COPY src/server.js src/server.js
COPY --from=builder /app/src/public src/public
COPY entrypoint.sh /entrypoint.sh

RUN mkdir -p /data/icons && chmod +x /entrypoint.sh

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=10s \
  CMD wget -qO- http://localhost:3000/health || exit 1

# Entrypoint runs as root, chowns /data, then exec's as node
ENTRYPOINT ["/entrypoint.sh"]
