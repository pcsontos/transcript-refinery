#!/usr/bin/env bash
# A whisper-figyelő telepítése a gazdagépre (lásd: README.md).
#
#   DATA_ROOT=<a gazdagép adatgyökere> tools/whisper/deploy.sh <ssh-host>
#
# A fejlesztő gépen fordít (hordozható, statikus build), a kész csomagot ssh-n át szállítja, a modellt a gazdagép
# egyszer maga tölti le. Minden lépés újrafuttatható. A gép neve és az adatgyökér paraméter, nem kerül a repóba.
set -euo pipefail

HOST=${1:?Használat: DATA_ROOT=<adatgyökér> tools/whisper/deploy.sh <ssh-host>}
DATA_ROOT=${DATA_ROOT:?Add meg a gazdagép adatgyökerét: DATA_ROOT=… tools/whisper/deploy.sh <ssh-host>}
WHISPER_CPP_DIR=${WHISPER_CPP_DIR:-$HOME/github/ggerganov/whisper.cpp}
LABEL=dev.peteroncode.whisper-watch
MODEL_NAME=ggml-large-v3-turbo.bin
MODEL_URL="https://huggingface.co/ggerganov/whisper.cpp/resolve/main/$MODEL_NAME"
HERE=$(cd "$(dirname "$0")" && pwd)
BUILD="$WHISPER_CPP_DIR/build-portable"

log() { printf '\n== %s\n' "$*"; }
die() { printf 'HIBA: %s\n' "$*" >&2; exit 1; }
remote() { ssh "$HOST" bash -s -- "$@"; }

[ -f "$WHISPER_CPP_DIR/models/$MODEL_NAME" ] || die "nincs helyi modell: $WHISPER_CPP_DIR/models/$MODEL_NAME (a sha256 összevetéséhez kell)"
[ -f "$WHISPER_CPP_DIR/samples/jfk.wav" ] || die "nincs minta: $WHISPER_CPP_DIR/samples/jfk.wav"

log "1. Build (hordozható, statikus, nem a gép-specifikus)"
cmake -S "$WHISPER_CPP_DIR" -B "$BUILD" -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DGGML_NATIVE=OFF >/dev/null
cmake --build "$BUILD" --target whisper-cli -j >/dev/null
BIN="$BUILD/bin/whisper-cli"
[ -x "$BIN" ] || die "nincs $BIN"

log "2. Hordozhatósági kapu"
if otool -L "$BIN" | tail -n +2 | grep -q '@rpath/'; then
  die "a whisper-cli @rpath/ függőséget tartalmaz: nem hordozható"
fi
if otool -L "$BIN" | tail -n +2 | awk '{print $1}' | grep -Ev '^(/usr/lib/|/System/)' | grep -q .; then
  die "a whisper-cli nem rendszerkönyvtárhoz is kapcsolódik: nem hordozható"
fi
FLAGS="$BUILD/ggml/src/CMakeFiles/ggml-cpu.dir/flags.make"
[ -f "$FLAGS" ] || die "nincs $FLAGS: a kapu nem ellenőrizhető"
if grep -Eqi 'native|i8mm' "$FLAGS"; then
  die "a build gép-specifikus (native/i8mm a flags.make-ben): nem fut minden Apple-chipen"
fi
# A Python-szintaxis a gazdagép 3.9-es értelmezőjére.
/usr/bin/python3 -c "import ast,sys; ast.parse(open(sys.argv[1]).read(), feature_version=(3,9))" "$HERE/whisper_transcribe.py"

log "3. Csomag"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/pkg/bin" "$TMP/pkg/samples"
cp "$BIN" "$TMP/pkg/bin/whisper-cli"
cp "$HERE/whisper_transcribe.py" "$TMP/pkg/"
cp "$WHISPER_CPP_DIR/samples/jfk.wav" "$TMP/pkg/samples/"
cp "$HERE/$LABEL.plist" "$TMP/pkg/"
tar -C "$TMP/pkg" -czf "$TMP/whisper.tar.gz" .

log "4. Szállítás"
REMOTE_TAR="/tmp/whisper-transcribe-$$.tar.gz"
scp -q "$TMP/whisper.tar.gz" "$HOST:$REMOTE_TAR"
remote "$REMOTE_TAR" "$DATA_ROOT" <<'REMOTE'
set -euo pipefail
tarball=$1; data_root=$2
share="$HOME/.local/share/whisper-transcribe"
mkdir -p "$share" "$HOME/.local/bin"
# A bin/, a wrapper, a samples/ és a plist cserélődik; a models/ soha.
rm -rf "$share/bin" "$share/samples"
tar -C "$share" -xzf "$tarball"
rm -f "$tarball"
chmod +x "$share/bin/whisper-cli" "$share/whisper_transcribe.py"
ln -sf "$share/whisper_transcribe.py" "$HOME/.local/bin/whisper-transcribe"
mkdir -p "$data_root/refinery/whisper/inbox" "$data_root/refinery/whisper/work" "$data_root/refinery/whisper/failed" \
         "$data_root/refinery/sources/whisper" "$data_root/refinery/logs"
REMOTE

log "5. Modell (egyszer)"
LOCAL_SHA=$(shasum -a 256 "$WHISPER_CPP_DIR/models/$MODEL_NAME" | awk '{print $1}')
remote "$MODEL_NAME" "$MODEL_URL" "$LOCAL_SHA" <<'REMOTE'
set -euo pipefail
name=$1; url=$2; want=$3
dir="$HOME/.local/share/whisper-transcribe/models"
mkdir -p "$dir"
sha() { shasum -a 256 "$1" | awk '{print $1}'; }
if [ -f "$dir/$name" ] && [ "$(sha "$dir/$name")" = "$want" ]; then
  echo "A modell megvan, a sha256 egyezik: nincs letöltés."
  exit 0
fi
rm -f "$dir/$name"
curl -fL -C - -o "$dir/$name.partial" "$url"
if [ "$(sha "$dir/$name.partial")" != "$want" ]; then
  rm -f "$dir/$name.partial"
  echo "HIBA: a letöltött modell sha256-ja eltér." >&2
  exit 1
fi
mv "$dir/$name.partial" "$dir/$name"
echo "A modell letöltve."
REMOTE

log "6-7. Smoke testek (CLI és watch; ideiglenes mappában, a valódi sources és logs érintetlen)"
remote <<'REMOTE'
set -euo pipefail
share="$HOME/.local/share/whisper-transcribe"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
/usr/bin/python3 "$share/whisper_transcribe.py" "$share/samples/jfk.wav" --lang en --output txt --output-dir "$tmp/cli"
grep -qi "ask not what your country" "$tmp/cli/jfk.en.txt"
echo "CLI smoke: rendben."
"$share/bin/whisper-cli" -m "$share/models/ggml-large-v3-turbo.bin" -f "$share/samples/jfk.wav" -l en -nt >"$tmp/gpu.log" 2>&1
grep -i "gpu name\|using Metal" "$tmp/gpu.log" | head -3 || { echo "HIBA: a Metal-eszköz nem látszik a naplóban." >&2; exit 1; }
! grep -Eqi "Library not loaded|Illegal instruction" "$tmp/gpu.log"
mkdir -p "$tmp/root/inbox"
cp "$share/samples/jfk.wav" "$tmp/root/inbox/jfk.wav"
printf '%s' '{"id":"jfk","title":"jfk","refinery_lang":"en","refinery_target":"whisper/smoke"}' >"$tmp/root/inbox/jfk.info.json"
/usr/bin/python3 "$share/whisper_transcribe.py" watch --root "$tmp/root" --out "$tmp/out" --logs "$tmp/logs" --once
test -f "$tmp/out/whisper/smoke/jfk.en.srt"
echo "watch smoke: rendben."
REMOTE

log "8. launchd"
remote "$LABEL" "$DATA_ROOT" <<'REMOTE'
set -euo pipefail
label=$1; data_root=$2
share="$HOME/.local/share/whisper-transcribe"
plist="$HOME/Library/LaunchAgents/$label.plist"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
sed -e "s|__HOME__|$HOME|g" -e "s|__DATA_ROOT__|$data_root|g" "$share/$label.plist" >"$plist"
plutil -lint "$plist" >/dev/null
uid=$(id -u)
launchctl bootout "gui/$uid/$label" 2>/dev/null || true
if ! launchctl bootstrap "gui/$uid" "$plist"; then
  if ! launchctl print "gui/$uid" >/dev/null 2>&1; then
    echo "Nincs grafikus munkamenet: jelentkezz be grafikusan a gazdagépen, majd futtasd újra." >&2
    exit 1
  fi
  exit 1
fi
launchctl print "gui/$uid/$label" | grep -E "state =|pid =" | head -2
REMOTE

log "Kész."
