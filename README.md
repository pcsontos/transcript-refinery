# Transcript Refinery

Kész `.vtt`/`.srt` feliratfájlokból strukturált tudásjegyzeteket készít egy
Obsidian vaultba — mindegy, mi állította elő őket.

> **Állapot: a v1 minden fázisa kész** (Fázis 0–5, ld.
> [`docs/roadmap.md`](<./docs/roadmap.md>)), és kész a Fázis 6 négy új
> receptje is. A teljes korpusz felügyelet nélkül végigfut: a futás JSONL naplót
> és Markdown riportot hagy maga után, a költségplafon a tiltás helyett
> szeletel, az átmeneti modellhibát korlátos újrapróbálkozás nyeli el. Hat
> recept van: összefoglaló, tanulókártya, kérdés-felelet, tisztított leirat
> (bekezdésenkénti időbélyeggel), Bloom-taxonómiás kártyák és strukturált
> jegyzet, és bármelyikük jegyzete lefordítható; a második iteráció mért haszna
> nemleges, a loop alapból egy körre áll. A feldolgozási sor Obsidianból
> vezérelhető (`scan --queue` / `run --queue`), és van egy csak olvasó
> Nuxt-felület az áttekintéshez és az élő követéshez.

## A probléma

A feliratfájl rossz olvasmány. A YouTube gördülő ablakos formátumban szolgálja ki,
ahol minden sor háromszor szerepel; az automatikus feliratozás írásjelek nélkül
érkezik; és egy negyvenperces előadásból tizenegyezer szónyi átirat lesz, amit
senki nem olvas újra.

Ez a projekt olyan jegyzetet csinál belőle, amit érdemes megtartani — és megméri,
mennyire jól csinálja.

## Amit megmértünk

A terv nem feltevéseken áll, hanem egy valós, 153 videós korpusz végigmérésén,
17 csatornáról:

| Megfigyelés | Mit változtatott a terven |
|---|---|
| Minden feliratsor **háromszor** szerepel — a szerzői feliratokban is, nem csak az automatikusakban | A deduplikáció univerzális normalizálási lépés, nem a minőségi ág elágazása. **66%** szöveget vesz le, mielőtt bármilyen modell látná |
| Az írásjel-sűrűség tisztán szétválasztja a felirat-forrásokat: a 100 szavankénti 1,0 és 4,0 írásjel közötti sáv gyakorlatilag üres | A minőségi kapu egyetlen küszöb, nulla modellhívással. A korpusz **47%-a** bizonyult automatikusnak |
| Deduplikáció után: medián **3 041** szó, maximum 22 477 | Minden átirat elfér egy kontextusablakban. A darabolás és map-reduce réteg, amit egy korábbi terv feltételezett, teljesen kimaradt |

## A megközelítés

- **TypeScript**, a modellhívásokhoz a Vercel AI SDK-val
- **A modellek egy LiteLLM gateway mögül** jönnek, ami az útválasztást, a kulcsonkénti
  keretet és az elköltés-követést adja. A gateway felállítása nem tartozik ide —
  a projekt adottnak veszi, hogy elérhető
- **Forrásfüggetlen bemenet: egy szerződés, akárhány feliratmappa.** A mag a kész
  `.vtt`/`.srt` fájllal szerződik, és nem érdekli, mi állította elő — letöltő
  eszköz, `whisper.cpp`, `yt-dlp` vagy kézi másolás egyaránt jó
- **A minőségi kapu felirat-forrásonként (szerzői/automatikus) osztályoz**,
  modellhívás nélkül — újratranszkribálás nincs az appban; egy külső eszköz
  kimenete egyszerűen egy újabb feliratforrás
- **Egyetlen valódi ágensi lépés**, nem raj: egy rubrika pontozza a kimenetet és
  konkrét hiányokat nevez meg, a generátor javít, korlátos iterációval. Ugyanaz a
  rubrika fut a mérésben is
- **A kimenet privát vaultba írt Markdown**, ami soha nem publikálódik
  automatikusan

## A hét döntés, egy mondatban

| Kérdés | Válasz |
|---|---|
| Ágens vagy munkafolyamat? | Egy valódi ágensi lépés — [evaluator–optimizer loop](<./docs/decisions/0001-agens-reteg.md>), felfújt megnevezés nélkül |
| Hogyan bővül új dokumentumtípussal? | [Egy kódmodul](<./docs/decisions/0002-dokumentumtipus-egyseg.md>) típusonként; prózatípusnál kb. tíz sor |
| Mi a bemenet? | [A kész feliratfájl](<./docs/decisions/0008-forras-fuggetlen-bemenet.md>) — az előállítója érdektelen |
| Ki tartatja be a költségkeretet? | [Két réteg](<./docs/decisions/0004-koltsegplafon.md>): a LiteLLM keményen, az alkalmazás előzetes becsléssel |
| Groq vagy lokális transzkripció? | [Egyik sem](<./docs/decisions/0008-forras-fuggetlen-bemenet.md>): a transzkribálás kívül esik a hatókörön — a lokális `whisper.cpp` melletti [korábbi döntés](<./docs/decisions/0005-transzkribalasi-ut.md>) történeti, ha az eszköz mégis megépül |
| Mivel mérünk? | [Evalite, saját rubrikákkal](<./docs/decisions/0006-eval-stack.md>) — egy idegen is le tudja futtatni |
| Mi az első futtatható szelet? | [Normalizálás vault-írással](<./docs/decisions/0007-elso-szelet.md>), modellhívás nélkül |

## Ami már fut

A `scan` felderíti a konfigurált feliratmappák elemeit — metaadatfájl
nélkülieket is —, és hálózat nélkül kiírja mindegyikhez a forrást, a címet, a
nyers és normalizált szószámot és a felirat-minőséget. A `run` átiratot
készít, és a vault `Inbox/transcript-refinery/<forrás>/` fája alá írja, a
forrásmappa szerkezetét tükrözve: nulla duplikált sor, érvényes frontmatter
metaadat nélkül is, nulla wikilink. Másodszor futtatva nem ír semmit. Sérült feliratfájl nem állítja meg
a futást, a záró riport megnevezi a hibás elemet és az okát. Recept nélkül ez
bit-azonos a Fázis 0 kimenetével — a Fázis 1 ezt nem törte el.

A `refinery fetch subtitle` YouTube-feliratot és `.info.json` metaadatot tölt egy helyi
mappába a `yt-dlp` segítségével. Ami már ott van, azt átugorja. A `run` és a
`watch` ettől még csak a helyi fájlt olvassa, hálózat nélkül.

A `refinery serve` egy videó feliratát és `info.json` fájlját az R2-be tölti. A
Telegram-ajtó a `worker/` csomag.

A `serve` három lekérdező végpontot is ad: a `GET /ping` és a `GET /version`
hitelesítés nélkül válaszol (`ok`, illetve `{"version": …}`), a `GET /status`
a `REFINERY_SERVE_SECRET` Bearer-tokenjével a verziót és az éppen futó munka
azonosítóját adja (`{"version": …, "busy": <jobId> | null}`).

A `run --recipe summary` a normalizált átiratból összefoglaló jegyzetet
készít, korlátos evaluator–optimizer loopban: a modell generál, egy rubrika
pontoz **és konkrét hiányokat nevez meg**, a modell eddig javít, amíg átmegy
vagy elfogy az iterációkeret. A modellek egy LiteLLM gateway mögül jönnek,
szerepet kérve (`draft`, `judge`), nem modellnévvel. A futás előtt kiírt
becslés a megadott plafon felett el sem indul; futás közben a tényleges
token-felhasználásból számolt költés állítja meg a köteget, ha túllépné.
A két kaput mindkét irányból ellenőriztük: mesterségesen alacsony plafonnal a
becslés a futás előtt megállítja a köteget, plafon hiányában pedig a
konfiguráció el sem indul — egyik esetben sincs modellhívás.
A `--dry-run` a fájlírást és az állapotrögzítést hagyja ki, a modellhívást
nem: a generálás és a pontozás valós költséggel lezajlik.

A `--recipe flashcards` és a `--recipe qa` ugyanezen a motoron fut — a
felvételük egyetlen sort sem változtatott rajta. A kártyarecept nem
sorformátumot kér a modelltől, hanem sémás objektumot, és a vault alakját
(`## kérdés` + bekezdés, az Obsidian Decks plugin szerint) egy renderer
állítja elő: a formátum így nem a modell figyelmén múlik. Egy nulla tokenes
kapu előbb fut, mint a bírók — ismétlődő kérdésnél vagy válasz nélküli
fejlécnél a drága pontozás el sem indul.

A tisztított leirat három szinten készül; a töltelékszavakat mindhárom
eltávolítja:

| recept | mit csinál | időbélyeg |
|---|---|---|
| `clean-mild` | írásjel, nagybetű, félrehallás; nincs fejléc, nincs átfogalmazás | bekezdésenként |
| `clean-moderate` | bekezdések és `##` fejlécek a témaváltásnál; nincs átfogalmazás | bekezdésenként |
| `clean-deep` | írott formára szerkeszt: ismétlések nélkül, átfogalmazva, tartalmat nem hagy ki | nincs |

Az időbélyeg a valós elhangzási idő (`[MM:SS]`, egy órán túl `[H:MM:SS]`). A
modell prózát ír, időbélyeg nélkül; egy determinisztikus lépés utólag
horgonyozza a bekezdéseket a feliratsorokhoz sorrendtartó illesztéssel. A
bizonytalanul illeszkedő bekezdés időbélyeg nélkül kerül a jegyzetbe — a
jegyzet maga elkészül, nem a teljes, már kifizetett modellkimenet vesztődik
el —, és a futás naplója megmondja, hány bekezdés maradt így. Egy nulla
tokenes hűségkapu állítja meg a modellt, ha tisztítás helyett összefoglalna.

A `--recipe bloom` a Bloom-taxonómia hat szintjére (Remember → Create) tagolt
kártyapaklit ír, szintenként 3–5 kártyával; a szint és a nehézség a kártya
hátulján áll, a jegyzet pedig `decks` címkét kap, így a Decks plugin paklinak
ismeri fel. A `--recipe notes` fogalmakra bontott jegyzetet ír: fogalmanként
definíció, magyarázat, példa és variáció, egy a fogalmakból összeállított
összefoglaló táblázat, és ahol a tartalom indokolja, Mermaid-diagram. Mindkét
recept sémás, a Markdownt renderer írja. A példa, a variáció és a magasabb
Bloom-szintek szándékosan túlmehetnek az átiraton — egy saját bíró azt
ellenőrzi, hogy nem mondanak ellent neki.

A fordítás nem külön dokumentumtípus, hanem bármelyik recept kész jegyzetének
célnyelvű változata. A `translate` konfigkulcs mondja meg a célnyelvet és a
forrásreceptek listáját; mindegyikből saját recept lesz (`--recipe clean-moderate-hu`,
`summary-hu`…), saját pipával a sorban. A fordítás a vaultban lévő
forrásjegyzetből készül — egy kézzel javított jegyzet javított változata fordul
—, és ahhoz mér: egy nulla tokenes vázkapu ellenőrzi, hogy az időbélyegek, a
fejlécek, a bekezdések, a listák, a táblázat és a kódblokkok megmaradtak. A
bekezdések és a fejlécek számában kis eltérést tűr — a természetes
átfogalmazás ne buktasson el hibátlan fordítást —, a Bloom-kártyák fejléceiben
viszont nem, mert ott egy fejléc egy kártya. Ha a forrás még nem készült el, a
fordítás modellhívás nélkül kimarad, és a sor megnevezi az okot.

A feldolgozási sor a válogatást Obsidianba viszi. A `scan --queue` a vault
`_queue.md` jegyzetébe fésüli a felderített videókat: forrásmappánként egy
számozott `##` fejléc, alatta videónként egy számozott `###` fejléc, és
receptenként egy üres pipa. A fordítás a forrásreceptje alá kerül, behúzott
nyelvi al-sorként — a célnyelvű videó alá nem, mert ott nincs mit fordítani
(ha ott mégis áll fordítássor, a scan törli, a pipáltat is):

```markdown
## 1. transcripts/youtube/Csatorna
### 1. Egy videó címe %%dQw4w9WgXcQ%%
- [x] summary — ✓ 0.97 · $0.0471 · [jegyzet](<…>)
  - [ ] hu
- [ ] flashcards
```

A `run --queue` a kipipált (videó, recept) párokat dolgozza fel —
egyetlen közös becsléssel és költségplafonnal —, és az eredményt pontszámmal,
költséggel és a jegyzet linkjével ugyanazokba a sorokba írja vissza. A
sorszámokat minden scan újraírja, a jegyzetet atomian írja, és ha nincs mit
feldolgozni, nulla modellhívással, commit nélkül fut le. A korábbi, lapos
formátumú sort az első `scan --queue` egyszer átalakítja, a pipákkal együtt.

A scan a már kész párokat is bepipálja, akkor is, ha a jegyzet a soron kívül
(`run --recipe`) készült: az állapottár szerinti eredménnyel, vagy ha csak a
jegyzetfájl van meg, `✓ már a vaultban` utótaggal. A meglévő `✓` utótaghoz
nem nyúl, pipát nem vesz le, és a saját sorokat érintetlenül hagyja. A futás a
modellhívás előtt megnézi, létezik-e már a jegyzet; ha igen, késznek veszi, és
nem fizet érte (`--force` nélkül).

A felület (`mise exec -- pnpm web`, `http://127.0.0.1:4310`) csak olvas. Az
áttekintő a korpusz állapotát, a pontszámok eloszlását receptenként és a
feldolgozási sort mutatja; az elem oldalán a jegyzet és a normalizált átirat
egymás mellett látszik, a bíró hiánylistájával — így kiderül, *miért* maradt egy
jegyzet a küszöb alatt. Egy CLI-ből indított futás élőben követhető: az éppen
feldolgozott elem, a pontszám és a költés a plafonhoz mérve, SSE-n.
A riportoldal (`/reports`) csatornánként összesíti a korpuszt, a költést és a
jegyzetek minőségét, két grafikonnal (költés futásonként, költség csatornánként
receptre bontva); a hiányzó (csatorna, recept) párokhoz vágólapra másolható
`refinery run` parancsot ad — elindítani a CLI-ből kell.

A mérési harness (`pnpm eval`) ugyanezt a loopot futtatja egy determinisztikus
fixture-modellel: kulcs és hálózat nélkül, három szintetikus feliraton fut le,
és mindegyikre valódi pontszámot ír ki. A minőségi kapu precisionje és
recallja is szám formájában mért: mindkettő **1,000** a hét elemű, kézzel
címkézett halmazon, a határeset benne van.

Egy valós vaultban, valós LiteLLM-hívással is ellenőrizve: egyetlen elemre
futtatva elkészül az átirat **és** az összefoglaló jegyzet is ugyanabban a
mappában, a jegyzet frontmatterében a modellel, az iterációszámmal és a
pontszámmal; a futás kiírja az elért pontszámot és a költséget; másodszor
futtatva a recept is „már feldolgozva" státuszt kap, nulla új modellhívással.

Az `evalite` natív függősége (`better-sqlite3`) miatt a telepítéshez C++
fordítói lánc kell: macOS-en az Xcode parancssori eszközei
(`xcode-select --install`), Debian/Ubuntu-n a `build-essential` és a `python3`
csomag. Maga a mérés (`pnpm eval`) ezután API-kulcs és hálózat nélkül fut.

668 teszttel, 69 tesztfájlban — köztük egy Fázis 0-ra írt végponttól
végpontig teszttel, és a fenti, valós adaton mért eredményekkel a Fázis 1-re,
valamint a felület e2e-tesztjeivel (15 teszt, 2 fájl).

## Beállítás

```bash
cp refinery.config.example.yaml refinery.config.yaml
# írd át benne a vault és a feliratmappák útvonalát
echo "LITELLM_API_KEY=sk-..." > .env   # csak recepthez kell
pnpm install
pnpm build
```

Minden beállítás a `refinery.config.yaml`-ból jön; a `--config` kapcsolóval
másik fájl is megadható. Környezeti változó egyetlen értéket hoz, a
`LITELLM_API_KEY`-t — az titok, aminek nincs helye verziókövetett fájlban.

## Futtatás

A build (`pnpm build`) után a CLI parancsok a `pnpm exec refinery` vagy `npx refinery` formában hívhatók (fejlesztés alatt: `npx tsx src/cli.ts`).

### Gyorsindítás (Cheat Sheet)

```bash
# 1. Felderítés és a vault feldolgozási sorának (_queue.md) frissítése
pnpm exec refinery scan --queue

# 2. A sorban kipipált [x] elemek feldolgozása (modellekkel és költségplafonnal)
pnpm exec refinery run --queue

# 3. Csak átirat generálása modellhívás nélkül (ingyenes)
pnpm exec refinery run

# 4. Katalógus és állapot áttekintése terminálban
pnpm exec refinery list --channels

# 5. Mappák előtérbeli figyelése új feliratok esetén (watch mód)
pnpm exec refinery watch

# 6. Olvasási felület (Web UI) indítása (http://127.0.0.1:4310)
pnpm web
```

> [!TIP]
> A teljes parancssori referencia, az összes kapcsoló (`--limit`, `--force`, `--dry-run`, `--no-judge`), a globális terminálos bekötés (`npm link`), a receptek modelljeinek finomhangolása és a webes felület részletes bemutatása a [**Futtatási útmutatóban (docs/usage.md)**](docs/usage.md) található.

### Fejlesztés és hibakeresés (Debugging)

A projekt két külön futtatókörnyezetet használ a háttérmunkákhoz: a helyi `refinery serve` démont (Node.js) és a Cloudflare Workert (`workerd`). Mindkettőhöz előre konfigurált VS Code és parancssori hibakeresési eszközök állnak rendelkezésre.

#### 1. `refinery serve` debuggolása

A `refinery serve` az Infisical titkokkal (`R2_*`, `REFINERY_SERVE_SECRET`) indul, és a 8787-es porton fogadja a Worker felől érkező feliratletöltési munkákat a helyi `tmp/serve-out` mappába.

- **Parancssorból:**
  ```bash
  pnpm serve
  ```
- **VS Code-ban (töréspontokkal):**
  1. Válaszd a **`CLI: Serve (pnpm serve)`** profilt a *Run and Debug* menüben (**F5**).
  2. Ez egy dedikált JavaScript Debug Terminalt nyit, ahol a `tsx` futtatja a TypeScript forrást.
  3. A töréspontok közvetlenül a TypeScript fájlokban (`src/serve/command.ts`, `src/serve/http.ts`, `src/serve/job.ts`) megállnak.

> [!TIP]
> Ha a 8787-es port foglalt (`EADDRINUSE`), ellenőrizd az előzőleg futó folyamatokat: `lsof -i :8787`, majd állítsd le a korábbi példányt.

#### 2. Cloudflare Worker (`worker/src/index.ts`) debuggolása

A Worker nem Node.js alatt fut, hanem a Cloudflare saját V8 futtatókörnyezetében (`workerd`), amelyet a Wrangler emulál lokálisan. A Wrangler egy V8 Inspector portot nyit (alapértelmezetten `9229`).

##### A) VS Code Attach Debugger (Ajánlott)

1. **Worker elindítása:**
   - Parancssorból: `pnpm worker:dev`
   - Vagy VS Code-ból: indítsd el a **`Worker: Dev (wrangler dev)`** profilt.
   *(Ez az Infisical titkokat betöltve a `8788`-as porton indítja a szervert, hogy ne ütközzön a 8787-es `refinery serve` porttal, és megnyitja a `9229`-es inspector portot).*
2. **Debugger csatlakoztatása:**
   - Indítsd el a **`Worker: Attach (port 9229)`** konfigurációt a VS Code-ban (**F5**).
3. **Töréspont elhelyezése:**
   - Helyezz el töréspontokat a `worker/src/index.ts` fájlban (pl. `fetch` vagy `scheduled` metódusban).
4. **Kérés kiváltása (trigger):**
   - **Percenkénti cron / `handleCron` tesztelése:**
     ```bash
     curl http://localhost:8788/__scheduled
     ```
   - **Telegram webhook tesztelése:**
     ```bash
     curl -X POST http://localhost:8788/telegram \
       -H "Content-Type: application/json" \
       -H "X-Telegram-Bot-Api-Secret-Token: <titok>" \
       -d '{"update_id": 1, "message": {"message_id": 1, "chat": {"id": 123456}, "text": "https://www.youtube.com/watch?v=..."}}'
     ```
   - **Belső visszahívás tesztelése:**
     ```bash
     curl -X POST http://localhost:8788/internal/jobs/<jobId> \
       -H "Authorization: Bearer <titok>" \
       -H "Content-Type: application/json" \
       -d '{"status": "ready", "title": "Teszt videó"}'
     ```

##### B) Chrome DevTools (Egygombos megoldás)

Ha terminálban futtatod a `pnpm worker:dev` parancsot:
1. Nyomd meg a **`d`** billentyűt a terminálban.
2. A Wrangler automatikusan megnyitja a Chrome DevTools felületét.
3. A *Sources* fül alatt keresd meg az `index.ts` fájlt, és helyezz el töréspontokat.

##### C) Éles Worker logok valós idejű követése (Tail)

A felhőben futó éles Cloudflare Worker naplóinak élő streamelése a terminálba:
```bash
npx wrangler tail --config worker/wrangler.toml
```

> [!NOTE]
> A Telegram bot, a Cloudflare Worker és a `peter-mba` célgépen futó démon teljes topológiáját, a webhook regisztrációját és az éles/helyi működés részletes szétválasztását az [Üzemeltetési és Topológiai Útmutató](docs/operations/telegram-worker-topology.md) dokumentálja.

### Tesztek és mérések

```bash
pnpm test        # Unit és integrációs tesztek (Vitest)
pnpm eval        # Determinisztikus Evalite mérések szintetikus adaton (offline)
pnpm typecheck   # Típusellenőrzés
pnpm lint        # Linter futtatása
```

A tesztek **rögzített időzónában** futnak: a `vitest.config.ts` a `TZ`-t
`Europe/Budapest`-re állítja, és ez a shell `TZ`-jét is felülírja. Ez nem
kozmetika — a riport fejléce helyi időt ír, tehát rögzítés nélkül a tesztje a
futtató gépen múlna. A zóna szándékosan **nem** UTC: nulla eltolásnál a helyi
idő és az UTC kimenete egybeesne, és egy UTC-re való visszaesés észrevétlen
maradna. Ha a rögzítést kiveszed, a `report.test.ts` fejléc-tesztjei minden
más zónában elbuknak — ez a szándék, nem hiba.

### A minta-korpusz behozatala más gépről

Fejlesztéshez elég a feliratokat és a metaadatot átmásolni; médiafájlt a
csővezeték nem olvas:

```bash
rsync -av --prune-empty-dirs --include='*/' --include='*.info.json' \
      --include='*.srt' --include='*.vtt' --exclude='*' \
      user@gep:/utvonal/feliratok/ ./tmp/feliratok/
```
