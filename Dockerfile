FROM node:26.2-bookworm AS build
RUN corepack enable
WORKDIR /src
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build

FROM node:26.2-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ADD https://github.com/yt-dlp/yt-dlp/releases/download/2026.03.17/yt-dlp_linux /usr/local/bin/yt-dlp
RUN chmod 755 /usr/local/bin/yt-dlp
WORKDIR /app
COPY --from=build /src/package.json /app/package.json
COPY --from=build /src/dist /app/dist
COPY --from=build /src/node_modules /app/node_modules
RUN chmod 755 /app/dist/cli.js && ln -s /app/dist/cli.js /usr/local/bin/refinery
CMD ["refinery", "serve"]
