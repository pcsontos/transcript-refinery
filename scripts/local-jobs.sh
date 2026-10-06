#!/bin/sh
# A helyi D1 utolsó munkasorai. Az éles adatbázist nem éri el.
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
limit=${1:-5}
case $limit in
  *[!0-9]*|0) echo "A limit pozitív egész szám legyen." >&2; exit 1 ;;
esac

cd "$root"
npx wrangler d1 execute transcript-refinery --local --config worker/wrangler.toml \
  --command "SELECT job_id, video_id, status, phase, error, title FROM jobs ORDER BY rowid DESC LIMIT ${limit};"
