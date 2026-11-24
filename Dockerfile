FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY lib ./lib
COPY web ./web
COPY scripts ./scripts
COPY docs ./docs
COPY legacy/index.html ./legacy/index.html
RUN mkdir -p dist && npm run build

FROM node:24-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 TOWER_DATA_DIR=/data
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && mkdir -p /data && chown node:node /data
COPY --from=build /app/lib ./lib
COPY --from=build /app/dist ./dist
COPY --from=build /app/docs ./docs
COPY server.mjs ./
COPY scripts/backup.mjs ./scripts/backup.mjs
USER node
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "--dns-result-order=ipv4first", "--use-env-proxy", "server.mjs"]
