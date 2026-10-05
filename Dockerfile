FROM node:26.2-bookworm AS build
RUN npm install -g pnpm@12.6.0
WORKDIR /src
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build

FROM node:26.2-bookworm-slim
LABEL org.opencontainers.image.source="https://github.com/pcsontos/transcript-refinery"
ARG TARGETARCH
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git openssh-client \
 && rm -rf /var/lib/apt/lists/* \
 && git config --system --add safe.directory '*' \
 && if [ "$TARGETARCH" = "arm64" ]; then \
      curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/download/2026.03.17/yt-dlp_linux_aarch64 -o /usr/local/bin/yt-dlp; \
    else \
      curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/download/2026.03.17/yt-dlp_linux -o /usr/local/bin/yt-dlp; \
    fi \
 && chmod 755 /usr/local/bin/yt-dlp
WORKDIR /app
COPY --from=build /src/package.json /app/package.json
COPY --from=build /src/dist /app/dist
COPY --from=build /src/node_modules /app/node_modules
RUN chmod 755 /app/dist/cli.js && ln -s /app/dist/cli.js /usr/local/bin/refinery
CMD ["refinery", "serve"]
