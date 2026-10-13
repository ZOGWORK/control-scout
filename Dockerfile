# FTC Control Scout — one container: API + built web app.
# Data (SQLite + packs) lives in /app/.data — mount a volume there.
#   docker build -t control-scout .
#   docker run -p 3000:3000 -v scout-data:/app/.data --env-file .env control-scout
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/predict-engine/package.json packages/predict-engine/
COPY packages/predict-engine packages/predict-engine
RUN npm ci --no-audit --no-fund --loglevel=error
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY --from=build /app /app
RUN mkdir -p /app/.data && chown -R node:node /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npx", "tsx", "server/index.ts"]
