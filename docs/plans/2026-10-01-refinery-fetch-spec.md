# Spec — A `refinery fetch` parancs

**Dátum:** 2026-10-01 · **Státusz:** jóváhagyva (parancsalak és modularitás finomítva, 2026-10-02)

Ez a dokumentum a [`2026-10-01-refinery-fetch-brief.md`](./2026-10-01-refinery-fetch-brief.md)
briefből és a jóváhagyott tervezésből készült. Az implementációs terv ebből
épül fel.

A brief a célmappa példáiban a listát csatorna alá tette. A tervezés ezt
felülírta: a lista egy mappában marad, csatornamappa csak az egyedi videónál van.
A brief a letöltést `refinery fetch youtube` alakban írta, elhagyható `youtube`
szóval. A 2026-10-02-i felülvizsgálat ezt felülírta: a mód a `subtitle`, és ez
a `fetch` utáni kötelező első argumentum (`refinery fetch subtitle <url> ...`),
később bővíthető `audio` és `video` módokkal. A kódstruktúrában a `subtitle`-specifikus
logika a `src/fetch/subtitle/` almappába kerül.

## A cél egy mondatban

A `refinery fetch subtitle` egy vagy több YouTube-címből feliratfájlt (`.vtt` vagy `.srt`)
és `.info.json` metaadatot ír egy helyi mappába a `yt-dlp` segítségével,
hogy a `refinery run` a csővezetékben ezt offline dolgozhassa fel.

## 1. Parancs és felület

```bash
refinery fetch subtitle <url> [--out <út>] …
refinery fetch subtitle --list <fájl> [--out <út>] …
```

- A parancs neve: `refinery fetch subtitle`.
- Ha az argumentumok között ott a `--help` vagy a `-h`, a parancs a teljes `USAGE` szöveget írja, és 0-s kóddal kilép. Ez a mód vizsgálata előtt történik, tehát a `refinery fetch --help` és a `refinery fetch subtitle --help` is súgó.
- Ha az első argumentum hiányzik, vagy kapcsoló, az üzenet: `Hiányzó fetch-mód. Ismert: subtitle`. Ha az első argumentum más szó, az üzenet: `Ismeretlen fetch-mód: <szó>. Ismert: subtitle`. Mindkettő indulási hiba, 1-es kód, letöltés nélkül. A sorrend: súgó, aztán mód, aztán config és a többi argumentum. Hibás módnál a config nem töltődik be.
- Egy pozicionális cím, vagy `--list`. A kettő együtt hiba, és az is hiba, ha egyik sincs. További pozicionális argumentum hiba.
- A `main` a `fetch` szót a közös `parseArgs` előtt ismeri fel, és a `commandFetch`-nek adja a maradék argumentumot (`argv.slice(1)`). A mód szót ez a parancskezelő vizsgálja. A `run --out` így továbbra is ismeretlen kapcsoló.
- A `USAGE` felsorolja a `fetch subtitle` parancsot és a kapcsolóit.

| Kapcsoló | Jelentés | Alapértelmezés |
|---|---|---|
| `--out <út>` | Célmappa, abszolút útvonal. | A config első forrásának útvonala (`sources[0].path`). |
| `--list <fájl>` | Szövegfájl, soronként egy YouTube-cím. | Nincs; vagy egy cím van, vagy a `--list`. |
| `--sub-lang <kódok>` | Vesszővel tagolt nyelvkódok (pl. `hu,en` vagy `en-US`). | A config `languages` listája; ha az üres, `hu,en`. |
| `--sub-format <f>` | Feliratformátum, vesszővel tagolva. Csak a `vtt` és az `srt` fogadható el. | `vtt,srt`. |
| `--overwrite` | A kész felirat és `.info.json` felülírása. | Kikapcsolva. |
| `--flat` | Minden fájl közvetlenül az `--out` gyökerébe kerül. | Kikapcsolva. |
| `--playlist-items <i>` | Csak a lista kiválasztott elemei (a `yt-dlp` `-I` kapcsolója, pl. `1:10`). | Nincs szűrés. |
| `--yes-playlist` | A `watch?v=…&list=…` alak a teljes listát jelenti, nem csak az egyetlen videót. | Kikapcsolva: alapból csak a videó. |
| `--config <út>` | Konfigurációs fájl helye. | A szokásos keresés (`refinery.config.yaml`). |

Ha `--out` és `--sub-lang` is meg van adva, és nincs `--config`, a parancs nem keres és nem tölt be konfigurációs fájlt. Ha valamelyik hiányzik, a parancs a meglévő `loadCliConfig` útvonalon olvassa be a konfigurációt, de a `validateConfig` nem fut: a vault létezése nem feltétel.

A célmappa nem létező szülője automatikusan létrejön (`mkdir -p`). Ha a cél útvonalán normál fájl áll, a parancs induláskor hibaüzenettel megáll: `A --out nem mappa: <út>`.

## 2. Platform és bemenet

A parancs automatikusan felismeri a címet. Platformszó a parancssorban nincs.

- YouTube: `https://www.youtube.com/watch?v=…`, `https://youtu.be/…`, `https://www.youtube.com/shorts/…`, `https://www.youtube.com/playlist?list=…`, `https://music.youtube.com/…`, `https://www.youtube-nocookie.com/embed/…`, valamint a csupasz 11 karakteres videóazonosító (`[A-Za-z0-9_-]{11}`).
- A `watch?v=…&list=…` cím `--yes-playlist` nélkül a megadott videó, a lista paraméterét a parancs eldobja. `--yes-playlist` esetén a lista a mérvadó.
- Idegen platform vagy érvénytelen cím: a tétel hibás sor lesz a kimeneten, és a parancs a többi tétellel folytatja. Listafájl esetén a hibás sor nem állítja meg a többi sor feldolgozását.
- A listafájlban az üres sor és a `#`-tel induló megjegyzéssor kimarad. Ha a fájl a szűrés után üres, a parancs hibaüzenettel megáll: `A listafájl nem tartalmaz címet.`.

## 3. Célmappa-szerkezet és átugrás

Az átugrás a célmappára vonatkozik, egy szint mélyen, rekurzió nélkül.

- Lista: `<out>/<sanitize(cím [playlist_id])>/`.
- Videó: `<out>/<sanitize(csatorna)>/`.
- `--flat`: az `--out` gyökere.

Kész a pár, ha a mappában van legalább egy nem üres `.vtt` vagy `.srt`, amelynek a neve ` [<id>]` után nyelvi utótagot és ezt a kiterjesztést viseli, és a kért nyelvek egyike illik rá, továbbá van `.info.json`, amelynek az `id` mezője ugyanez a videó. A nyelvi illeszkedés a `chooseSubtitle` szabálya: a fájl címkéje kisbetűsen a kért kóddal kezdődik. `en` kérésre `en` és `en-US` is jó. `en-US` kérésre a puszta `en` nem jó.

A csatorna és a lista címe egy metaadat-lekérdezésből jön, fájlírás nélkül. A letöltő hívás csak ezután, és csak hiányzó párra indul. `--overwrite` esetén vizsgálat nincs, a letöltő hívás `--force-overwrites`.

Ha a pár hiányzik, csak ennek a videónak az üres felirata és az érvénytelen `.info.json` fájlja törlődik a hívás előtt. Érvénytelen a JSON, ha nem olvasható, vagy az `id` mezője nem ez a videó. Más videó fájlja a mappában marad. A hívás ilyenkor `--no-overwrites`: a jó felirat megmarad, a hiányzó pótlódik. A nem üres, de csonka feliratot késznek vesszük; frissíteni a `--overwrite` tudja. A `chooseSubtitle` nem exportált függvény: a fetch a prefix-szabályt megismétli, nem importálja.

Ugyanaz a videó két listában két példány. A `run` egyet dolgoz fel, mert az elem azonosítója a videóazonosító.

## 4. Modulok és adatfolyam

A jövőbeli bővíthetőség (`audio`, `video`) érdekében a kód két szintre tagolódik:

```
src/fetch/
├── classify.ts          # Bemenet/URL osztályozás (videó, playlist, rejected)
├── command.ts           # Fő belépési pont, súgó, fetch-mód diszpécser, összesítés
└── subtitle/            # Subtitle modalitás specifikus kódja
    ├── args.ts          # Subtitle kapcsolók és argumentumok elemzése
    ├── skip.ts          # Célmappa, kész feliratpár detektálása, tisztítás
    └── ytdlp.ts         # yt-dlp feliratos argumentumok, JSON parse és futtató
```

| Egység | Fájl | Feladat |
|---|---|---|
| `classifyInput` | `src/fetch/classify.ts` | Egy sorból videó, lista vagy elutasítás |
| `parseSubtitleArgs` | `src/fetch/subtitle/args.ts` | Argumentumból kérés vagy hibaüzenet (a `subtitle` utáni kapcsolókra és címre) |
| `alreadyFetched` / mappa | `src/fetch/subtitle/skip.ts` | A célmappában megvan-e a kész feliratpár |
| `ytdlp` felirat-illesztő | `src/fetch/subtitle/ytdlp.ts` | Argumentumlista és a folyamat futtatója |
| `commandFetch` | `src/fetch/command.ts` | Mód ellenőrzése (`subtitle`), diszpecselés, kiírás, kilépési kód |

A `src/cli.ts` a `fetch` ágon, a közös elemző előtt hívja a `commandFetch`-et. A fetch a `sanitizeSegment` és szükség esetén a `loadCliConfig` függvényt importálja. Csővezetéket, állapottárat és watch-ot nem.

A futtató: argumentumlista be, `{ code, stdout, stderr }` vissza. Alapból a `yt-dlp` folyamatot indítja, nem leválasztva. A teszt hamis futtatót ad.

Egy tétel útja:

1. A listafájl soraiból címke lesz. Üres és `#` sor kimarad.
2. Osztályozás. A `youtube.com`, a `*.youtube.com`, a `youtu.be` és a `youtube-nocookie.com` YouTube. A `/playlist` útvonal, illetve a `list=` paraméter `v=` nélkül, lista. A `watch?v=…&list=…` videó, `--yes-playlist` mellett lista. A `youtu.be/<id>`, a `/shorts/<id>` és a csupasz 11 karakteres `[A-Za-z0-9_-]{11}` videó. A videóazonosító mindig 11 ilyen karakter; ha a `v=` nem ilyen, a sor elutasítás. Minden más elutasítás.
3. Listánál egy `yt-dlp -J --flat-playlist` hívás adja a címet, a listaazonosítót és az elemeket. A letöltés URL-je `https://www.youtube.com/watch?v=<id>`. Az elemek `id` mezője a mérvadó.
4. Videónál egy `yt-dlp -J --no-playlist` hívás adja a csatornát, a címet és az azonosítót. A JSON `id` mezője a mérvadó.
5. Az `alreadyFetched` a kiszámolt célmappában néz körül. Kész pár és nincs `--overwrite`: átugorva, letöltő hívás nélkül.
6. Különben a letöltő hívás. Utána ugyanaz az `alreadyFetched`: kész pár esetén letöltve, felirat nélkül esetén felirat nélkül, nem nulla kilépési kód és kész pár nélkül hiba.
7. A lista lekérése egyetlen hiba, ha a folyamat nem nulla kilépéssel tér vissza vagy a JSON-ból nincs listaazonosító. A lista videóira ilyenkor nincs hívás. Nulla elemű lista egy hiba: `a lista üres`. Azonosító nélküli listaelem egy hiba: `hiányzó videóazonosító`. A többi elem ettől még lefut.

A metaadat- és a listahívás `-J`, ami szimuláció, fájlt nem ír. A `--skip-download` és a `--no-progress` ezeken a hívásokon is rajta van. A `--playlist-items` csak a listahíváson `-I` érték.

A letöltő hívás argumentumai, ebben a szerepben:

```text
yt-dlp
  --skip-download
  --write-subs
  --write-auto-subs
  --sub-langs <vesszős nyelvlista>
  --sub-format <perjeles formátum, pl. vtt/srt>
  --write-info-json
  --no-playlist
  <--force-overwrites VAGY --no-overwrites>
  --output "%(title)s [%(id)s].%(ext)s"
  --paths "home:<célmappa>"
  "<url>"
```

## 5. Hibakezelés és kimenet

A parancs soronként jelzi a haladást:

```text
[OK]   Cím [id]
[SKIP] Cím [id]
[SKIP] Nincs felirat: Cím [id]
[FAIL] <url>: <hibaüzenet>
```

- Sikeres letöltés: `[OK]   <cím> [<id>]`. Az `[OK]` után pontosan három szóköz áll, hogy a négybetűs `[SKIP]` és `[FAIL]` címkékkel egy vonalba essen.
- Átugrás kész pár miatt: `[SKIP] <cím> [<id>]`.
- Átugrás felirat hiánya miatt: `[SKIP] Nincs felirat: <cím> [<id>]`. A parancs ezt hibaként számolja a kilépési kódban.
- Hiba: `[FAIL] <cím>: <hibaüzenet>`. A hibaüzenet a `yt-dlp` szabványos hibakimenetének első sora, vagy a formátumhiba leírása (`nem YouTube-cím`, `a lista üres`, `hiányzó videóazonosító`).

A futás végén egyetlen összesítő sor jelenik meg:

```text
Kész: <letöltött> letöltve, <átugrott> átugorva, <nincs felirat> felirat nélkül, <hibás> hibás.
```

- A számlálók pontosan ezeket a kategóriákat fedik le. A „felirat nélkül” nem számít bele az átugrottak közé, és a hibásak közé sem.
- Ha az összesítésben a letöltött és az átugrott számon kívül minden más 0, a kilépési kód `0`.
- Ha van legalább egy felirat nélküli vagy hibás tétel, a kilépési kód `1`.
- Ha az indulás hiúsul meg (hibás parancssori kapcsoló, nem létező listafájl, relatív célmappa, vagy a `yt-dlp` hiánya), a parancs a hibakimenetre ír egyetlen sort, és `1`-gyel lép ki. Összesítés ilyenkor nincs.
- Ha a `yt-dlp` hiányzik a rendszerről (`ENOENT`), a hibaüzenet:
  `A yt-dlp nem található a PATH-on. Telepítés: brew install yt-dlp vagy mise use yt-dlp`
- Ha a folyamat futás közben `SIGINT` jelzést kap (`Ctrl+C`), a parancs a még nem indított tételeket elengedi, a már befejezett tételek után kiírja az összesítést, és `130`-as kóddal lép ki.

## 6. Határok és nem-célok

- Nincs párhuzamos letöltés. A tételek szigorúan egymás után futnak.
- Nincs beépített Whisper vagy más átíró motor. A fetch csak meglévő feliratot ment.
- Nincs bejelentkezés, sütiátadás (`--cookies`), felhasználónév/jelszó, sem `--netrc`.
- Nincs automatikus konverzió más formátumba (ffmpeg, `--convert-subs` kimarad).
- Nem használjuk a `yt-dlp` letöltési archívumát (`--download-archive`), az átugrást a fájlrendszer állapota vezérli.
- Nem támogatott más videómegosztó (pl. Vimeo).
