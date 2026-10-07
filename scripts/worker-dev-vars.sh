#!/bin/sh
# A Worker hat változóját tölti le az Infisicalból a worker/.dev.vars fájlba.
# Az értékeket nem írja ki.
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
dest="$root/worker/.dev.vars"
project_id="1c1c1853-c58b-401f-a414-2bca9076e16f"
keys="TELEGRAM_BOT_TOKEN TELEGRAM_BOT_USERNAME TELEGRAM_ALLOWED_EMAILS TELEGRAM_WEBHOOK_SECRET REFINERY_SERVE_SECRET SERVE_URL"

if ! command -v infisical >/dev/null 2>&1; then
  echo "Az infisical CLI hiányzik." >&2
  exit 1
fi

tmp=$(mktemp "$root/worker/.dev.vars.XXXXXX")
trap 'rm -f "$tmp"' EXIT

# shellcheck disable=SC2086
infisical secrets get $keys \
  --env=dev \
  --path=/peter-mbp \
  --projectId="$project_id" \
  --output dotenv \
  --silent > "$tmp"

for key in $keys; do
  if ! grep -q "^${key}=" "$tmp"; then
    echo "Az Infisical válaszából hiányzik: $key" >&2
    exit 1
  fi
done

chmod 600 "$tmp"
mv "$tmp" "$dest"
trap - EXIT
echo "A Worker hat változója a worker/.dev.vars fájlban van."
