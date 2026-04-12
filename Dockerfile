# ACTC 網站 — Node 應用（資料庫由獨立容器提供，見 docker-compose.yml）
FROM node:20-alpine

RUN apk add --no-cache tini

WORKDIR /app

COPY package.json package-lock.json ./
# 使用 install：部分 lockfile 在 npm ci + --omit=dev 下與 Docker 內建 npm 版本不相容（peer optional 解析）
RUN npm install --omit=dev

COPY . .

RUN mkdir -p uploads/images uploads/files \
    && chown -R node:node /app

USER node

ENV NODE_ENV=production
ENV PORT=5001
ENV HOST=0.0.0.0

EXPOSE 5001

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
