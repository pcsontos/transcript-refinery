#!/bin/sh
# A debug-bot helyi lánca: D1 migráció, worker/.dev.vars, refinery serve, Wrangler, ngrok, webhook.
# Az éles bot tokenjéhez és webhookjához nem nyúl. A titkokat nem írja ki.
# Leállításkor törli a debug-bot webhookját, és visszaállítja a korábbi worker/.dev.vars fájlt.
set -eu

# A worktree gyökere. A Wrangler ezt a fájlt olvassa, az ngrok a saját helyi API-ján árulja a nyilvános címet.
root=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
project_id="1c1c1853-c58b-401f-a414-2bca9076e16f"
dest="$root/worker/.dev.vars"
logdir="$root/tmp/telegram-debug"
ngrok_api="http://127.0.0.1:4040/api/tunnels"

token=
backup=
serve_pid=
wrangler_pid=
ngrok_pid=
cleaning=0

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Hiányzik: $1" >&2
    exit 1
  fi
}

port_busy() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

wait_port() {
  port=$1
  i=0
  while [ "$i" -lt 60 ]; do
    if port_busy "$port"; then
      return 0
    fi
    sleep 1
    i=$((i + 1))
  done
  echo "A $port port nem nyílt meg. Log: $logdir" >&2
  return 1
}

kill_tree() {
  pid=$1
  [ -n "$pid" ] || return 0
  children=$(pgrep -P "$pid" 2>/dev/null || true)
  for child in $children; do
    kill_tree "$child"
  done
  kill "$pid" 2>/dev/null || true
}

# Ctrl+C és minden kilépés ide fut. Csak a debug-bot webhookját törli, az éles botét nem.
# Utána leállítja az ngrokot, a Wranglert és a serve-et, majd visszaírja a korábbi .dev.vars fájlt.
cleanup() {
  [ "$cleaning" = 1 ] && return 0
  cleaning=1
  trap - EXIT INT TERM
  if [ -n "$token" ]; then
    err=$(mktemp)
    curl -sS --max-time 20 "https://api.telegram.org/bot${token}/deleteWebhook?drop_pending_updates=true" >/dev/null 2>"$err" || {
      sed "s#${token}#***#g" "$err" >&2 || true
    }
    rm -f "$err"
  fi
  kill_tree "$ngrok_pid"
  kill_tree "$wrangler_pid"
  kill_tree "$serve_pid"
  if [ -n "$backup" ]; then
    if [ -s "$backup" ]; then
      mv "$backup" "$dest"
    else
      rm -f "$dest" "$backup"
    fi
  fi
}

value_of() {
  key=$1
  printf '%s\n' "$secrets" | jq -er --arg key "$key" '.[] | select(.secretKey == $key) | .secretValue'
}

trap cleanup EXIT INT TERM

# A 8787 a serve, a 8788 a Wrangler, a 9229 a Worker töréspontja, a 9230 a serve töréspontja, a 4040 az ngrok saját API-ja.
# Ha bármelyik foglalt, nem indítunk fél láncot. A 9229-en maradt workerd miatt a Wrangler elszáll, és a 8788 sose nyílik meg.
need pnpm
need npx
need infisical
need jq
need curl
need ngrok
need lsof
need pgrep

if [ ! -f "$root/refinery.config.yaml" ]; then
  echo "Hiányzik a refinery.config.yaml a gyökérkönyvtárból ($root)." >&2
  echo "Másold át a refinery.config.example.yaml-t, és állítsd be a vault.path-t és modelleket!" >&2
  exit 1
fi

for port in 8787 8788 9229 9230 4040; do
  if port_busy "$port"; then
    echo "A $port port foglalt. Állítsd le a korábbi folyamatot." >&2
    exit 1
  fi
done

cd "$root"
# A helyi D1 sémája. A Wrangler később --remote nélkül indul, ezért ezt az adatbázist használja.
pnpm worker:migrate:local

# Az éles TELEGRAM_BOT_TOKEN nem kell. A debug-nevek külön kulcsok a /peter-mbp úton.
secrets=$(infisical secrets get \
  TELEGRAM_DEBUG_BOT_TOKEN \
  TELEGRAM_OWNER_CHAT_ID \
  TELEGRAM_DEBUG_WEBHOOK_SECRET \
  REFINERY_SERVE_SECRET \
  --env=dev \
  --path=/peter-mbp \
  --projectId="$project_id" \
  --output json \
  --silent)

token=$(value_of TELEGRAM_DEBUG_BOT_TOKEN)
owner=$(value_of TELEGRAM_OWNER_CHAT_ID)
webhook_secret=$(value_of TELEGRAM_DEBUG_WEBHOOK_SECRET)
serve_secret=$(value_of REFINERY_SERVE_SECRET)

# A BotFather-tokenben van kettőspont. A 11 karakteres helyőrző itt megáll, folyamatot még nem indítottunk.
case $token in
  *:*) ;;
  *)
    echo "A TELEGRAM_DEBUG_BOT_TOKEN nem BotFather-token. Írd felül az Infisicalban." >&2
    exit 1
    ;;
esac
if [ "${#webhook_secret}" -lt 16 ] || [ -z "$owner" ] || [ -z "$serve_secret" ]; then
  echo "A debug webhook-titok, a chat-azonosító vagy a REFINERY_SERVE_SECRET hiányzik az Infisicalból." >&2
  exit 1
fi

# A Wrangler a TELEGRAM_BOT_TOKEN nevet olvassa, ezért a debug-token ide kerül, nem a DEBUG_ néven.
# A SERVE_URL a helyi serve. A Cloudflare-titok nem változik. Leállításkor a backup kerül vissza.
backup=$(mktemp)
if [ -f "$dest" ]; then
  cp "$dest" "$backup"
fi
umask 077
tmp=$(mktemp "$root/worker/.dev.vars.XXXXXX")
{
  printf 'TELEGRAM_BOT_TOKEN=%s\n' "$token"
  printf 'TELEGRAM_OWNER_CHAT_ID=%s\n' "$owner"
  printf 'TELEGRAM_WEBHOOK_SECRET=%s\n' "$webhook_secret"
  printf 'REFINERY_SERVE_SECRET=%s\n' "$serve_secret"
  printf 'SERVE_URL=%s\n' "http://127.0.0.1:8787"
} > "$tmp"
chmod 600 "$tmp"
mv "$tmp" "$dest"

mkdir -p "$logdir" "$root/tmp/serve-out"

# A serve a 8787-en hallgat. A visszahívás a helyi Wrangler 8788-as portjára megy, nem az éles Worker D1-jébe.
# A --inspect csak a tsx folyamatra kerül. A NODE_OPTIONS a pnpm-et is inspectorra tenné, és a 9230 foglalt maradna.
infisical run --env=dev --path=/peter-mbp --projectId="$project_id" -- \
  env SERVE_OUT="$root/tmp/serve-out" WORKER_CALLBACK_URL="http://127.0.0.1:8788" \
  pnpm exec tsx --inspect=127.0.0.1:9230 src/cli.ts serve >"$logdir/serve.log" 2>&1 &
serve_pid=$!
wait_port 8787
wait_port 9230

# Export nélkül indul, hogy a pnpm worker:dev ne írja felül a most összerakott .dev.vars fájlt.
# A 9229-es port a VS Code "Worker: Attach" profiljáé. A --test-scheduled csak a /__scheduled hívásra fut.
npx wrangler dev --config worker/wrangler.toml --port 8788 --inspector-port 9229 --test-scheduled \
  >"$logdir/wrangler.log" 2>&1 &
wrangler_pid=$!
wait_port 8788 || {
  echo "A Wrangler logja:" >&2
  tail -n 40 "$logdir/wrangler.log" >&2 || true
  exit 1
}

# A Telegram a localhostot nem éri el. Az ngrok a 8788-at viszi ki, a nyilvános címet a 4040-es API adja.
ngrok http 8788 --log stdout >"$logdir/ngrok.log" 2>&1 &
ngrok_pid=$!

public_url=
i=0
while [ "$i" -lt 30 ]; do
  public_url=$(curl -sS --max-time 2 "$ngrok_api" | jq -r '[.tunnels[] | select(.proto == "https") | .public_url][0] // empty' || true)
  if [ -n "$public_url" ]; then
    break
  fi
  sleep 1
  i=$((i + 1))
done
if [ -z "$public_url" ]; then
  echo "Az ngrok nem adott https címet. Log: $logdir/ngrok.log" >&2
  exit 1
fi

# Csak a debug-token. A callback_query a summary gomb; message nélkül a YouTube-cím sem érkezne meg.
err=$(mktemp)
body=$(curl -sS --max-time 20 "https://api.telegram.org/bot${token}/setWebhook" \
  -F "url=${public_url}/telegram" \
  -F "secret_token=${webhook_secret}" \
  -F 'allowed_updates=["message","callback_query"]' 2>"$err") || {
  sed "s#${token}#***#g" "$err" >&2
  rm -f "$err"
  exit 1
}
rm -f "$err"
if ! printf '%s\n' "$body" | jq -e '.ok == true' >/dev/null; then
  echo "A debug-bot webhookját a Telegram nem fogadta el." >&2
  printf '%s\n' "$body" | jq '{ok, description, error_code}' >&2 || true
  exit 1
fi

echo "A debug-bot webhookja: ${public_url}/telegram"
echo "A Wrangler töréspontja: 127.0.0.1:9229"
echo "A serve töréspontja: 127.0.0.1:9230"
echo "Logok: $logdir"
echo "Állj le Ctrl+C-vel. Az éles bot webhookja nem változik."

# A script addig él, amíg a három folyamat él. Ha bármelyik kilép, a cleanup lebontja a többit is.
while kill -0 "$serve_pid" 2>/dev/null && kill -0 "$wrangler_pid" 2>/dev/null && kill -0 "$ngrok_pid" 2>/dev/null; do
  sleep 2
done
echo "Egy folyamat leállt. Log: $logdir" >&2
exit 1
