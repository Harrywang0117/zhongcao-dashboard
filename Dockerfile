FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY index.html vite.config.js ./
COPY public ./public
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime-dependencies

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:22-bookworm-slim AS runtime

ARG APP_UID=10001
ARG APP_GID=10001
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4173
ENV DATA_DIR=/data

RUN groupadd --gid "${APP_GID}" app \
  && useradd --uid "${APP_UID}" \
    --gid app \
    --no-create-home \
    --shell /usr/sbin/nologin \
    app

WORKDIR /app
COPY --from=runtime-dependencies --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist
COPY --chown=app:app package.json ./
COPY --chown=app:app server.mjs ./
COPY --chown=app:app server ./server
COPY --chown=app:app src/lib ./src/lib
COPY --chown=app:app public ./public

USER app
EXPOSE 4173

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4173/readyz').then((response)=>{if(!response.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
