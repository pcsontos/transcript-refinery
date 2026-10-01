# Brief — A `refinery fetch` parancs (YouTube és Playlist Ingest)

**Dátum:** 2026-10-01  
**Cél:** Egy dedikált előkészítő (ingest) parancs, amely YouTube videók és teljes lejátszási listák feliratait és metaadatait tölti le a helyi fájlrendszerbe a `yt-dlp` segítségével, a meglévő fájlok automatikus átugrásával.

---

## 1. Háttér és motiváció

A Transcript Refinery alapelve ([`decisions/0008`](./decisions/0008-forras-fuggetlen-bemenet.md)), hogy a finomító mag (`refinery run`, `refinery watch`) kizárólag kész, helyi `.vtt`/`.srt` feliratfájlokból és `.info.json` metaadatfájlokból dolgozik. Ez garantálja, hogy a transzkript-feldolgozás, normalizálás és az LLM-alapú jegyzetkészítés determinisztikus, hálózatfüggetlen és offline maradjon.

Ugyanakkor a feliratok kézi letöltögetése nehézkes. Szükség van egy beépített, kényelmes letöltő eszközre, amely:
1. Közvetlenül letölti a feliratokat és a metaadatokat a felhasználó által megadott feliratmappába (`sources`).
2. Támogatja az egyedi videókat és a **teljes YouTube playlisteket** is.
3. Képes **URL-listafájlból kötegelten** (batch) dolgozni.
4. **Idempotens**: a már letöltött videókat automatikusan átugorja.
5. Nyitva hagyja az utat a későbbi transzkribálási megoldások (pl. lokális Whisper hangfájlokhoz / felirat nélküli videókhoz) előtt.

---

## 2. Felhasználói felület és használati esetek (CLI)

### A) Egyedi videó letöltése
```bash
refinery fetch youtube https://www.youtube.com/watch?v=dQw4w9WgXcQ \
  --out /Users/valaki/feliratok/youtube \
  --sub-lang=hu,en \
  --sub-format=srt,vtt
```
*(A `youtube` kulcsszó elhagyható, az URL alapján automatikusan felismeri.)*

### B) Teljes lejátszási lista (Playlist) letöltése
```bash
refinery fetch https://www.youtube.com/playlist?list=PLEDw4Kzv523E \
  --out /Users/valaki/feliratok/youtube \
```
*Viselkedés:* Végigmegy a lejátszási lista összes videóján, és letölti mindegyikhez a feliratot és a metaadatot. Ha egy videó felirata már a mappában van, átugorja (kivéve ha a `--overwrite` kapcsoló aktív).

### C) Kötegelt (batch) letöltés fájlból
```bash
refinery fetch --list=youtube-videos-list.txt \
  --out /Users/valaki/feliratok/youtube \
  --sub-lang=hu,en
```

A bemeneti fájl (`youtube-videos-list.txt`) soronként tartalmazza a címeket. Támogatja a vegyes tartalmat (egyedi videók és playlistek), az üres sorokat és a `#` kezdetű megjegyzéseket:

```text
# --- Kiemelt előadások ---
https://www.youtube.com/watch?v=dQw4w9WgXcQ
https://youtu.be/9bZkp7q19f0

# Rövid videó-ID is megadható közvetlenül
jNQXAC9IVRw

# --- Teljes kurzus / Playlist ---
https://www.youtube.com/playlist?list=PLEDw4Kzv523E

# Régebbi meetup felvételek
https://www.youtube.com/watch?v=kXYiU_JCYtU
```

---

## 3. Kapcsolók és alapértelmezések

| Kapcsoló | Leírás | Alapértelmezés |
|---|---|---|
| `<url>` | Letöltendő YouTube videó vagy playlist URL. | – |
| `--list <fájl>` | Letöltendő URL-ek listája soronként. | – |
| `--out <útvonal>` | Célkönyvtár a feliratoknak és metaadatoknak. | `refinery.config.yaml` `sources[0]`, vagy ha nincs konfig, kötelező megadni. |
| `--sub-lang <kódok>` | Vesszővel elválasztott nyelvkódok (pl. `hu,en,en-US`). | `refinery.config.yaml` `languages`, vagy `hu,en`. |
| `--sub-format <formátum>` | Előnyben részesített feliratformátum. | `vtt,srt`. |
| `--overwrite` (vagy `--force`) | Már létező feliratok és metaadatok kényszerített újraletöltése és felülírása. | `false` (alapértelmezetten a már meglévő fájlokat átugorja). |
| `--flat` | Letiltja az automatikus csatorna- és playlist-almappák létrehozását, mindent közvetlenül a `--out` gyökerébe tesz. | `false` (alapértelmezetten hierarchikus almappák jönnek létre). |
| `--playlist-items` | Elemek szűrése nagyméretű playlisteknél (pl. `1-10`). | Összes elem. |
| `--yes-playlist` | Engedélyezi a teljes lista letöltését akkor is, ha az URL videó-link playlist paraméterrel (`watch?v=...&list=...`). | `false` (alapból csak a videót tölti le). |

---

## 4. Architektúra és könyvtárszerkezet

### Könyvtárszerkezet a célmappában
A feliratok alapértelmezetten csatorna (és lejátszási listáknál csatorna + playlist) almappákba rendeződnek:
- **Egyedi videó esetén:**  
  `<out>/<Csatorna>/<Videó Címe> [<id>].*`  
  *Például:* `/feliratok/youtube/Fireship/TypeScript in 100 Seconds [id].hu.vtt`
- **Lejátszási lista (Playlist) esetén:**  
  `<out>/<Csatorna>/<Playlist Cím> [<playlist_id>]/<Videó Címe> [<id>].*`  
  *Például:* `/feliratok/youtube/Academind/React Teljes Kurzus [PL123]/01 - Bevezetés [id].hu.vtt`

Mivel a `transcript-refinery` ([`src/vault/paths.ts`](../src/vault/paths.ts)) 1:1-ben tükrözi a forrásmappák relatív almappa-szerkezetét, **ugyanez a tiszta hierarchia automatikusan megjelenik az Obsidian vaultban is**:
`Inbox/transcript-refinery/youtube/Academind/React Teljes Kurzus [PL123]/01 - Bevezetés_summary.md`

### Miért a `yt-dlp` subprocess?
- A hivatalos YouTube Data API v3 nem engedélyezi harmadik fél nyilvános videóinak feliratletöltését (OAuth 403 hiba).
- A tisztán Node.js-es web-scraping csomagok törékenyek a YouTube botvédelmi és HTML változásaival szemben.
- A `yt-dlp` a legstabilabb, folyamatosan karbantartott eszköz, amely egyetlen hívással letölti a feliratot és a `.info.json` fájlt is.
- A projekt meglévő kódja ([`src/source/metadata.ts`](../src/source/metadata.ts)) eleve a `yt-dlp` mezőit (`upload_date`, `uploader`, `webpage_url`, `duration`, `tags`) olvassa.

### A háttérben lefutó parancs és sablonok
```bash
yt-dlp \
  --skip-download \
  --write-sub \
  --write-auto-sub \
  --sub-lang "<sub-lang>" \
  --sub-format "<sub-format>" \
  --write-info-json \
  <--no-overwrites VAGY --force-overwrites> \
  --output "<kimenetiSablon>" \
  --paths "home:<out>" \
  "<url>"
```

**Kimeneti sablonok:**
- **Hierarchikus (alapértelmezett, playlistnél):**  
  `--output "%(channel,uploader)s/%(playlist_title,playlist)s [%(playlist_id,playlist)s]/%(title)s [%(id)s].%(ext)s"`
- **Hierarchikus (alapértelmezett, egyedi videónál):**  
  `--output "%(channel,uploader)s/%(title)s [%(id)s].%(ext)s"`
- **`--flat` kapcsoló esetén:**  
  `--output "%(title)s [%(id)s].%(ext)s"`

*Megjegyzés az idempotenciáról:* Alapértelmezésben a `--no-overwrites` flag kerül átadásra a `yt-dlp`-nek, így a már létező fájlok automatikusan átugrásra kerülnek. Ha a felhasználó megadja a `--overwrite` (vagy `--force`) kapcsolót, akkor a parancs a meglévő fájlokat is felülírja.

### Előállított fájlok a célmappában
Minden letöltött elemhez:
1. `Videó Címe [id].<lang>.vtt` (vagy `.srt`)
2. `Videó Címe [id].info.json`

Ezek a fájlok azonnal és közvetlenül kompatibilisek a meglévő `folderSource` és `readSidecar` logikával, így a `refinery run` további módosítások nélkül fel tudja őket dolgozni.

---

## 5. Hibakezelés

1. **Hiányzó `yt-dlp` bináris:**  
   Ha a parancs futtatásakor a rendszer nem találja az eszközt (`ENOENT`), érthető hibaüzenetet ad a telepítési lépésekkel (`brew install yt-dlp` vagy `mise use yt-dlp`).
2. **Nincs felirat a videóhoz:**  
   Nem állítja meg a kötegelt feldolgozást; figyelmeztetést ír ki a konzolra (`[SKIP] Nincs felirat: <URL>`), és folytatja a következő elemmel.
3. **Privát / Törölt videó:**  
   Tételes hibajelzés a konzolon, az érvényes videók letöltése nem sérül.
4. **Futás végi összesítés:**  
   A letöltési ciklus végén tiszta riportot ad a sikeres, átugrott és hibás tételekről.

---

## 6. Jövőbeli bővíthetőség (Whisper)

A `fetch` réteg kialakítása lehetővé teszi, hogy később egy alternatív transzkribálási útvonal is csatlakozzon hozzá:
- Ha egy videóhoz egyáltalán nincs felirat, vagy helyi audiofájlt (pl. podcast mp3) adunk meg:
  `refinery fetch audio <fájl/url> --whisper`
- A Whisper szintén `.srt`/`.vtt` fájlt generál a célmappába, így a finomító mag architektúrája továbbra is 100%-ban forrásfüggetlen marad.
