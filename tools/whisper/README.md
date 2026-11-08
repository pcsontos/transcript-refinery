# whisper-figyelő (`tools/whisper`)

A refinery nem hív natív binárist. Az átírást egy **natív** (Metal) `whisper-cli` végzi a gazdagépen, a kapcsolat
csak egy mappa. Ez a mappa a refinery `whisper.dir` kulcsa (alapértéke `/data/whisper`).

```
<DATA_ROOT>/refinery/whisper/      # a konténerben: /data/whisper/
├── inbox/     <id>.<ext> + <id>.info.json   (a refinery írja, .partial + átnevezéssel)
├── work/      a figyelő munkafájljai
├── failed/    <id>.<ext> + <id>.info.json + <id>.log
└── heartbeat  a figyelő frissíti (pollozáskor és átírás közben is)
```

## Inbox-szerződés

- A refinery az `<id>.info.json`-t **előbb**, a hangot **utoljára** rakja le, mindkettőt `<név>.partial` + átnevezéssel.
  A figyelő a `*.partial` és a ponttal kezdődő fájlokat kihagyja, és hangot csak `info.json`-nal együtt vesz fel.
- A figyelő az `info.json`-ból csak ezeket olvassa: `id`, `title`, `refinery_lang`, `refinery_target`.
- Siker: `<out>/<refinery_target>/<id>.<nyelv>.srt` (előtte az `<id>.info.json`), majd az inbox-beli hang és a munkafájlok
  törlődnek. Ha a cél `.srt` már létezik, ez is hiba (nincs felülírás).
- Hiba: a bemenet a `failed/` mappába kerül, mellé `<id>.log` (az utolsó nem üres sor az ok).
- Egyszerre egy tétel, a legrégebbi előbb. Ha a figyelő átírás közben leáll, a tétel az `inbox/`-ban marad, és
  újraindításkor újra sorra kerül (a `work/` ilyenkor kiürül).
- Minden tételhez JSONL futásnapló készül a `--logs` mappába, a refinery formátumában, ezért a refinery-web `/runs`
  oldala változtatás nélkül mutatja a fázisokat (vár → konvertálás → átírás). Az életjel 30 mp-enként frissíti a
  napló fájlidejét.

## Telepítés

```bash
DATA_ROOT=<a gazdagép adatgyökere> tools/whisper/deploy.sh <ssh-host>
```

A fejlesztő gépen fordít (`WHISPER_CPP_DIR`, alapértéke `~/github/ggerganov/whisper.cpp`; hordozható statikus build,
`otool`/`flags.make` kapu), kész csomagot szállít, a modellt a gazdagép egyszer maga tölti le (sha256-ellenőrzéssel),
lefuttatja a CLI- és a watch-smoke testet egy ideiglenes mappában, majd betölti a launchd-ügynököt
(`dev.peteroncode.whisper-watch`, `RunAtLoad`, `KeepAlive`). Újrafuttatható; a második futás nem tölt le modellt, és
újraindítja a figyelőt.

Az ügynök csak **bejelentkezett grafikus munkamenetben** fut. Reboot után a gazdagépre egyszer be kell jelentkezni; addig
a refinery `transcribe`, `list --audios` és a `/runs` oldala figyelmeztet, hogy a figyelő nem fut, a leadott tétel pedig
sorban marad. Ha nincs grafikus munkamenet, a `deploy.sh` érthető üzenettel áll le.

### A `deploy.sh` lépései

Az 1–3. lépés a fejlesztő gépen, a 4–8. a gazdagépen fut (ssh-n át). Minden lépés újrafuttatható.

1. **Build.** `cmake` fordítja a `whisper-cli`-t a `$WHISPER_CPP_DIR/build-portable` mappába, statikusan és nem
   gép-specifikusan (`-DBUILD_SHARED_LIBS=OFF -DGGML_NATIVE=OFF`).
2. **Hordozhatósági kapu.** Leáll, ha a bináris `@rpath/` vagy nem rendszerkönyvtár-függőséget tartalmaz, vagy ha a
   `flags.make`-ben `native`/`i8mm` szerepel. A `whisper_transcribe.py` szintaxisát a gazdagép Python 3.9-ére is ellenőrzi.
3. **Csomag.** Egy tar-ba kerül a `whisper-cli`, a `whisper_transcribe.py`, a `jfk.wav` minta és a launchd-plist.
4. **Szállítás.** `scp` átviszi, a gazdagépen a `~/.local/share/whisper-transcribe/` mappába csomagol ki. A `bin/` és a
   `samples/` cserélődik, a `models/` soha. A `~/.local/bin/whisper-transcribe` symlink az új scriptre áll (felülírja a
   régit). Létrejönnek az `<DATA_ROOT>/refinery/whisper/{inbox,work,failed}`, a `refinery/sources/whisper` és a
   `refinery/logs` mappák.
5. **Modell.** Az `ggml-large-v3-turbo.bin` letöltése csak akkor történik, ha a gazdagépen nincs meg, vagy a sha256-ja
   eltér a fejlesztő gépen lévőétől; a letöltést (Hugging Face) a gazdagép végzi, `.partial` fájlba, sha256-ellenőrzéssel.
6. **CLI-smoke.** A `jfk.wav` angol átírása; a kimenetnek tartalmaznia kell: "ask not what your country".
7. **Watch-smoke.** Ellenőrzi, hogy a Metal-eszköz látszik a naplóban, majd egy ideiglenes mappában `watch --once`-szal
   átír egy tételt. A valódi `sources` és `logs` mappához nem nyúl.
8. **launchd.** A plistet a `~/Library/LaunchAgents` alá írja (`__HOME__`, `__DATA_ROOT__` helyettesítéssel), `plutil
   -lint`, `launchctl bootout` (a régi figyelő rövid időre leáll), majd `bootstrap`, végül kiírja az ügynök állapotát.

A 8. lépésnél leállított figyelő alól átírás közben kikerülő tétel az `inbox/`-ban marad, és újraindításkor újra sorra
kerül. Grafikus munkamenet nélkül a 8. lépés érthető hibával áll meg, de a 4–5. lépés addigra már lefutott.

## Használat

```bash
# kézi átírás (a régi wrapper változatlanul működik)
whisper-transcribe hang.m4a --lang hu --output srt --output-dir ./ki

# a figyelő kézi indítása (a launchd ezt futtatja)
whisper-transcribe watch --root <whisper-mappa> --out <sources-gyökér> [--logs <mappa>] [--interval 15] [--once]
```

A modell keresése: `$WHISPER_MODEL`, majd `<script mappa>/models/`, majd `~/.local/share/whisper-transcribe/models/`.
A `whisper-cli`: `<script mappa>/bin/whisper-cli`, majd `PATH`. Az `ffmpeg`: `PATH`, majd a Homebrew helyei.

## Tesztek

```bash
python3 -m unittest discover tools/whisper
```

Standard könyvtár, Python 3.9 (a gazdagép `/usr/bin/python3`-ja): nincs `match`, nincs `X | None`.

## Visszaállítás

- A figyelő leállítása: `launchctl bootout gui/$(id -u)/dev.peteroncode.whisper-watch`.
- A régi wrapper: a whisper.cpp klónban a `whisper_transcribe.py.bak` mentés, és a `~/.local/bin/whisper-transcribe`
  symlink visszaállítása.
- A `whisper.dir` mappa törlése (vagy átnevezése) kikapcsolja az átírást a refineryben; mappát a refinery nem hoz létre.
