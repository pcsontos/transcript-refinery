#!/bin/sh
# A Telegram-bot olvasott beállításai: azonosság, webhook, parancsok, név, leírás.
# A tokent nem írja ki. Nem állít webhookot és nem küld üzenetet.
set -eu

root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
vars="$root/worker/.dev.vars"
expected_url="https://transcript-refinery.peteroncode.workers.dev/telegram"

if [ -z "${TELEGRAM_BOT_TOKEN:-}" ]; then
  if [ ! -f "$vars" ]; then
    echo "Nincs TELEGRAM_BOT_TOKEN, és nincs $vars." >&2
    echo "Hozd létre a ./scripts/worker-dev-vars.sh futtatásával, vagy exportáld a tokent." >&2
    exit 1
  fi
  set -a
  # shellcheck disable=SC1090
  . "$vars"
  set +a
fi

if [ -z "${TELEGRAM_BOT_TOKEN:-}" ]; then
  echo "A worker/.dev.vars nem tartalmaz TELEGRAM_BOT_TOKEN értéket." >&2
  exit 1
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "A curl hiányzik." >&2
  exit 1
fi

call() {
  method=$1
  err=$(mktemp)
  body=$(curl -sS --max-time 20 "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/$method" 2>"$err") || {
    sed "s#${TELEGRAM_BOT_TOKEN}#***#g" "$err" >&2
    rm -f "$err"
    exit 1
  }
  rm -f "$err"
  printf '%s\n' "$body"
}

show() {
  method=$1
  echo "== $method =="
  body=$(call "$method")
  if command -v jq >/dev/null 2>&1; then
    printf '%s\n' "$body" | jq
  else
    printf '%s\n' "$body"
    echo
  fi
}

show getMe

echo "== getWebhookInfo =="
info=$(call getWebhookInfo)
if command -v jq >/dev/null 2>&1; then
  printf '%s\n' "$info" | jq
  url=$(printf '%s\n' "$info" | jq -r '.result.url // empty')
  if [ -z "$url" ]; then
    echo "A webhook ki van kapcsolva. A getUpdates csak ilyenkor ad frissítést." >&2
  elif [ "$url" != "$expected_url" ]; then
    echo "A webhook URL nem a várt Worker-cím: $expected_url" >&2
  fi
  if ! printf '%s\n' "$info" | jq -e '(.result.allowed_updates // []) as $u | ($u | length) == 0 or ($u | index("callback_query")) != null' >/dev/null; then
    echo "Az allowed_updates nem tartalmazza a callback_query értéket. A summary gomb koppintása nem érkezik meg a Workerhez." >&2
  fi
else
  printf '%s\n' "$info"
  echo
  echo "A jq nélkül az allowed_updates ellenőrzése kimarad." >&2
fi

show getMyCommands
show getMyName
show getMyDescription
show getMyShortDescription
