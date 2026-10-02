# Spec — A `refinery fetch` parancs

**Dátum:** 2026-10-01 · **Státusz:** jóváhagyva (parancsalak finomítva, 2026-10-02)

Ez a dokumentum a [`2026-10-01-refinery-fetch-brief.md`](./2026-10-01-refinery-fetch-brief.md)
briefből és a jóváhagyott tervezésből készült. Az implementációs terv ebből
készül; a végrehajtó mindkettőt olvassa.

A brief a célmappa példáiban a listát csatorna alá tette. A tervezés ezt
felülírta: a lista egy mappában marad, csatornamappa csak az egyedi videónál van.
A brief a letöltést `refinery fetch youtube` alakban írta, elhagyható `youtube`
szóval. A 2026-10-02-i felülvizsgálat ezt felülírta: a mód a `subtitle`, és ez
a `fetch` utáni kötelező első argumentum (`refinery fetch subtitle <url> ...`).

## A cél egy mondatban

A `refinery fetch subtitle` a `yt-dlp` segítségével YouTube-feliratot és
`.info.json` metaadatot tesz egy helyi mappába, a már meglévő párost átugorja,
a `run` és a `watch` pedig továbbra is csak a helyi fájlt olvassa.

## A tervezés során hozott döntések

| Kérdés | Döntés |
|---|---|
| Mód | `subtitle`, kötelező első argumentum a `fetch` után. Az `audio` és a `video` későbbi mód |
| Hova kerül a lista | **B:** `<out>/<Lista címe [playlist_id]>/…`. Csatornamappa csak az egyedi videónál van |
| Megvalósítás | TypeScript vezérlő, videónként egy letöltő `yt-dlp` hívás. A riport a mi eredményünkből áll |
| Átugrás terjedelme | A videó célmappája, nem az egész `--out` fa. Két lista két példányt kap; a `run` a videóazonosító miatt egyet dolgoz fel |
| Felülírás | `--overwrite`. A `--force` a `run` kapcsolója marad |
| Oldalak | Ebben a körben YouTube. Más címke soronként hiba, a köteg megy tovább |
| Felirat formátuma | `vtt` és `srt`. A `best` és a `--convert-subs` kimarad, ffmpeg nem kell |
| Whisper | Kimarad. Provider-felület sem készül |
| Bejelentkezés | Süti, `--netrc` és felhasználónév kimarad |
| Párhuzamosság | A tételek sorban futnak |
| Döntésnapló | A `0008` kap egy rövid kiegészítést. Új decision-fájl nem készül |
| Web és eval | Nem változik. Az `index.ts` nem exportálja a fetch-et |

## Határ a mag felé

A [`0008`](../decisions/0008-forras-fuggetlen-bemenet.md) magja érvényben marad:
a felderítés feliratfájlon iterál, az `.info.json` kiegészítő, a `run` és a
`watch` hálózatot nem hív. A `fetch` ugyanabban a CLI-ben él, és csak fájlt ír.

A `0008` végére ez a bekezdés kerül:

> **Kiegészítés (2026-10-01).** A `refinery fetch subtitle` a feliratot
> előállító testvérparancs: `yt-dlp`-vel `.vtt`/`.srt` és `.info.json` fájlt
> ír egy mappába. A csővezeték nem hívja, és a felderítés szerződése nem
> változik. A transzkribálás továbbra is kívül van.

A README „A megközelítés" listája a magra változatlan marad. Az „Ami már fut"
után egy bekezdés: a `refinery fetch subtitle` a feliratot és a metaadatot
tölti a forrásmappába; a `run` ettől még csak helyi fájlt olvas.

A `run` akkor látja a letett fájlokat, ha a `--out` egy konfigurált forrás,
vagy annak almappája. A `fetch` ezt nem ellenőrzi.

## 1. Parancs

```text
refinery fetch subtitle <url> [--out <út>] [--sub-lang <kódok>]
                        [--sub-format <formátumok>] [--overwrite] [--flat]
                        [--playlist-items <spec>] [--yes-playlist] [--config <út>]

refinery fetch subtitle --list <fájl> [--out <út>] …
```

- A `subtitle` a `fetch` utáni első argumentum. Kis- és nagybetű számít: a `Subtitle` nem ez a szó.
- Ha az argumentumok között ott a `--help` vagy a `-h`, a parancs a teljes `USAGE` szöveget írja, és 0-s kóddal kilép. Ez a mód vizsgálata előtt történik, tehát a `refinery fetch --help` és a `refinery fetch subtitle --help` is súgó.
- Ha az első argumentum hiányzik, vagy kapcsoló, az üzenet: `Hiányzó fetch-mód. Ismert: subtitle`. Ha az első argumentum más szó, az üzenet: `Ismeretlen fetch-mód: <szó>. Ismert: subtitle`. Mindkettő indulási hiba, 1-es kód, letöltés nélkül. A sorrend: súgó, aztán mód, aztán config és a többi argumentum. Hibás módnál a config nem töltődik be.
- Egy pozicionális cím, vagy `--list`. A kettő együtt hiba, és az is hiba, ha egyik sincs. További pozicionális argumentum hiba.
- A `main` a `fetch` szót a közös `parseArgs` előtt ismeri fel, és a `commandFetch`-nek adja a maradék argumentumot (`argv.slice(1)`). A mód szót ez a parancskezelő vizsgálja. A `run --out` így továbbra is ismeretlen kapcsoló.
- A `USAGE` felsorolja a `fetch subtitle` parancsot és a kapcsolóit.

| Kapcsoló | Jelentés | Alapértelmezés |
|---|---|---|
| `--out` | Célkönyvtár, abszolút útvonal | a config első `sources` eleme |
| `--sub-lang` | Nyelvek, vesszővel | a config `languages` listája, üres lista esetén `hu,en` |
| `--sub-format` | `vtt` és `srt`, vesszővel, a sorrend a preferencia | `vtt,srt` |
| `--overwrite` | Meglévő felirat és `.info.json` újraírása | ki |
| `--flat` | Minden fájl az `--out` gyökerébe | ki |
| `--playlist-items` | Lista szűrése, a `yt-dlp` `-I` értékeként, változtatás nélkül | a teljes lista |
| `--yes-playlist` | A `watch?v=…&list=…` cím listát jelent | ki: csak a `v=` videó |
| `--config` | Konfigurációs fájl | a szokásos `refinery.config.yaml` |

A configot csak akkor töltjük be, ha a `--out` vagy a `--sub-lang` hiányzik, vagy a `--config` meg van adva. Explicit `--config` mellett a fájl hibája akkor is megállít, ha mindkét kapcsoló megvan. `--out` és `--sub-lang` együtt, `--config` nélkül, hiányzó alapértelmezett configgal is elindul. A `validateConfig` nem fut: a vaultnak nem kell léteznie.

A `--sub-lang` egy eleme a felderítés nyelvi utótagja: `hu`, `en`, `en-US`. A kötőjel előtti részt kisbetűsítjük, a régiót változatlanul hagyjuk. Az `all` és a reguláris kifejezés hiba. A `--sub-format` csak `vtt` és `srt`, ismétlés nélkül, legalább egy értékkel. A `--list` útja a munkakönyvtárhoz képest relatív lehet. A `--playlist-items` videósoron nem számít; a formátumát a `yt-dlp` ellenőrzi.

A listafájl sorait trimeljük. Ami utána üres, vagy `#`-gal kezdődik, kimarad. A `#` a sor közepén a cím része.

## 2. Célfa és fájlok

- Egyedi videó: `<out>/<Csatorna>/<Cím> [<id>].<nyelv>.vtt` és mellette `<Cím> [<id>].info.json`.
- Lista: `<out>/<Lista címe [playlist_id]>/<Cím> [<id>].…`.
- `--flat`: mindkettő az `--out` gyökerében.

A csatorna a metaadat `channel` mezője, annak híján az `uploader`, annak híján a `névtelen`. A listamappa a lista címe és a `[playlist_id]`. Mindkét mappanév a `sanitizeSegment` függvényen megy át (`src/vault/sanitize.ts`). Üres lista címnél a mappa neve a szögletes zárójelbe tett listaazonosító.

A fájl nevét a `yt-dlp` adja, a sablon `%(title)s [%(id)s].%(ext)s`. A `--paths home:` a már kiszámolt célmappa. A felirat neve a `splitSubtitleName` szabályára illeszkedik. Az `.info.json` a nyelvi utótag nélküli alapnév mellett van, ott keresi a `readSidecar`.

Példa, ha a forrásmappa neve `youtube`:

```text
<out>/Fireship/TypeScript in 100 Seconds [dQw4w9WgXcQ].hu.vtt
<out>/Fireship/TypeScript in 100 Seconds [dQw4w9WgXcQ].info.json
<out>/React Teljes Kurzus [PL123]/01 - Bevezetés [abcdefghijk].hu.vtt
<out>/React Teljes Kurzus [PL123]/01 - Bevezetés [abcdefghijk].info.json
```

A vault ugyanezt a relatív fát tükrözi a forrás neve alatt.

## 3. Átugrás

Az átugrás a célmappára vonatkozik, egy szint mélyen, rekurzió nélkül.

- Lista: `<out>/<sanitize(cím [playlist_id])>/`.
- Videó: `<out>/<sanitize(csatorna)>/`.
- `--flat`: az `--out` gyökere.

Kész a pár, ha a mappában van legalább egy nem üres `.vtt` vagy `.srt`, amelynek a neve ` [<id>]` után nyelvi utótagot és ezt a kiterjesztést viseli, és a kért nyelvek egyike illik rá, továbbá van `.info.json`, amelynek az `id` mezője ugyanez a videó. A nyelvi illeszkedés a `chooseSubtitle` szabálya: a fájl címkéje kisbetűsen a kért kóddal kezdődik. `en` kérésre `en` és `en-US` is jó. `en-US` kérésre a puszta `en` nem jó.

A csatorna és a lista címe egy metaadat-lekérdezésből jön, fájlírás nélkül. A letöltő hívás csak ezután, és csak hiányzó párra indul. `--overwrite` esetén vizsgálat nincs, a letöltő hívás `--force-overwrites`.

Ha a pár hiányzik, csak ennek a videónak az üres felirata és az érvénytelen `.info.json` fájlja törlődik a hívás előtt. Érvénytelen a JSON, ha nem olvasható, vagy az `id` mezője nem ez a videó. Más videó fájlja a mappában marad. A hívás ilyenkor `--no-overwrites`: a jó felirat megmarad, a hiányzó pótlódik. A nem üres, de csonka feliratot késznek vesszük; frissíteni a `--overwrite` tudja. A `chooseSubtitle` nem exportált függvény: a fetch a prefix-szabályt megismétli, nem importálja.

Ugyanaz a videó két listában két példány. A `run` egyet dolgoz fel, mert az elem azonosítója a videóazonosító.

## 4. Modulok és adatfolyam

| Egység | Fájl | Feladat |
|---|---|---|
| `parseFetchArgs` | `src/fetch/args.ts` | Argumentumból kérés vagy hibaüzenet (a `subtitle` utáni kapcsolókra és címre) |
| `classifyInput` | `src/fetch/classify.ts` | Egy sorból videó, lista vagy elutasítás |
| `alreadyFetched` | `src/fetch/skip.ts` | A célmappában megvan-e a kész pár |
| `ytdlp` | `src/fetch/ytdlp.ts` | Argumentumlista és a folyamat futtatója |
| `commandFetch` | `src/fetch/command.ts` | Mód ellenőrzése (`subtitle`), sorrend, kiírás, kilépési kód |

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
[FAIL] <url>: <az első hiba sor>
Kész: 12 letöltve, 3 átugorva, 1 felirat nélkül, 2 hibás.
```

A cím a metaadat címe, annak híján az azonosító. Az elutasított sor hibás tétel, `[FAIL] <sor>: nem YouTube-cím`, és a hibás számlálóba megy. A „nincs felirat" a `[SKIP]` előtagot viseli, az összesítésben külön számláló.

Egy tétel hibája nem állítja meg a köteget.

Ezek az egész futást megállítják, letöltés előtt, 1-es kóddal:

- Rossz kapcsoló, hiányzó vagy ismeretlen fetch-mód, cím és `--list` együtt, vagy egyik sem, további pozicionális argumentum. A mód üzenete az 1. részben van.
- Üres listafájl a megjegyzések és az üres sorok elhagyása után.
- Hiányzó listafájl.
- A `--out` nem abszolút, vagy létezik, de nem mappa. Hiányzó mappát rekurzívan létrehozunk, a configból vett célmappát is. Ha a létrehozás nem sikerül, megállunk.
- Hibás `--sub-lang` vagy `--sub-format`.
- A config kell, de nem tölthető be. Az üzenet a betöltő üzenete.
- A `yt-dlp` nincs a `PATH`-on, vagy a `yt-dlp --version` nem nullával tér vissza. `ENOENT` esetén az üzenet: `A yt-dlp nem található a PATH-on. Telepítés: brew install yt-dlp vagy mise use yt-dlp`. Más hibánál az üzenet a folyamat első sora. Tétel nem indul.

Ha a bináris menet közben tűnik el, ugyanaz az üzenet, a kész tételek összesítése, kilépés 1, további tétel nincs.

Újrapróbálásból a `yt-dlp` saját rétege van. A privát, törölt és korhatáros videó `[FAIL]`, a `yt-dlp` első sorával.

A `Ctrl+C` az `installSigint` mintájára tételenként állítja meg a sort. A már futó `yt-dlp` megkapja a jelet, újabb tétel nem indul, és a félbeszakadt hívás nem kap tételsort. Összesítés akkor van, ha legalább egy tétel már eredményt kapott. A kilépési kód 130, akkor is, ha az eredmények között hibás is van. Üres eredménylistánál összesítés nincs, a kód akkor is 130.

| Helyzet | Kód |
|---|---|
| Minden tétel letöltve vagy átugorva | 0 |
| Volt felirat nélküli, hibás vagy elutasított sor | 1 |
| Indulási hiba | 1 |
| Megszakítás | 130 |

## 6. Tesztelés

A teszt hálózat és valódi YouTube nélkül fut. A parancs injektált futtatót kap. Egy teszt a valódi folyamatindítót egy olyan programmal helyettesíti, amely a `PATH`-on a `yt-dlp` előtt áll: feljegyzi az argumentumokat, és a `--paths` mappába a kért néven ír egy `.hu.vtt` fájlt meg egy `.info.json` fájlt. Ebből a `folderSource` és a `readSidecar` egy elemet olvas ki, a videóazonosítóval és a nyelvvel.

Futtató nélkül:

- A címfelismerés a `watch`, a `youtu.be`, a `shorts`, a csupasz azonosító és a `playlist?list=` címet a megfelelő típusba sorolja. A `watch?v=…&list=…` videó, `--yes-playlist` mellett lista. Az idegen címke elutasítás.
- Az argumentumok: cím és `--list` együtt hiba, egyik híján is hiba, relatív `--out` hiba, hibás nyelv és formátum hiba. A `subtitle` hiánya és az idegen első szó (`youtube`, `audio`) hiba, a megadott üzenettel. A `--help` a `subtitle` nélkül is a `USAGE` szöveget adja.
- Az átugrás a célmappában dönt. Meglévő pár: igen. Csak felirat, csak `.info.json`, üres felirat, rossz `id`, más nyelv: nem. Az `en` kérésre az `en-US` jó, az `en-US` kérésre a puszta `en` nem. A szomszéd listamappa másolata nem számít.
- Az argumentumlista tartalmazza a 4. rész letöltő kapcsolóit. A `best` és a `--convert-subs` nincs benne. `--overwrite` esetén `--force-overwrites`, egyébként `--no-overwrites`.

Hamis futtatóval:

- Kész párnál a metaadat-lekérdezés lefut, letöltő hívás nem.
- Listánál egy `-J --flat-playlist` hívás után csak a hiányzó videókra megy letöltés.
- A sérült `.info.json` és az üres felirat a hívás előtt törlődik, a hívás `--no-overwrites`.
- A felirat nélküli videó, a hibázó videó és a sikertelen listalekérés után a köteg megy tovább. Az utóbbi egy `[FAIL]`, a lista videóira nincs hívás.
- Hiányzó `yt-dlp`: az első indítás `ENOENT`, az üzenet említi a `brew install yt-dlp` és a `mise use yt-dlp` parancsot, kilépés 1, további hívás nincs.
- Vegyes eredménynél a számlálók és a kilépési kód az 5. rész táblája szerint alakul. `Ctrl+C` a második tétel előtt: a második letöltés nem indul, kilépés 130, az összesítés a kész tételt mutatja.

A `src/cli.test.ts` annyit véd, hogy a `USAGE` tartalmazza a `fetch subtitle` parancsot, a `fetch subtitle --out` nem kéri a vaultot, a `run` pedig nem fogadja a `--out` kapcsolót.

A `pnpm test` a worktree-ben zöld kell legyen.

## Kívül esik

Whisper, provider-felület, süti és bejelentkezés, ffmpeg, letöltési napló (`--download-archive`), más videómegosztó, a `refinery fetch audio` és a `refinery fetch video`, webes indítás, a `run` és a `watch` viselkedése, a felderítés és a sidecar olvasás módosítása, eval.
