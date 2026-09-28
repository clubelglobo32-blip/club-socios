FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice-writer libreoffice-calc \
    fonts-liberation fonts-dejavu-core fontconfig \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

ENV NODE_ENV=production
EXPOSE 10000
CMD ["node", "server.js"]
