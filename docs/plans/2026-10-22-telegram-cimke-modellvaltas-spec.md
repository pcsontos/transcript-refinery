# Spec — Telegram: elemcímke a futásüzenetekben és receptenkénti modellváltás

**Dátum:** 2026-10-22 · **Státusz:** tervezés alatt

Ez a dokumentum a #274 és a #292 issue közös tervezéséből készült. Ahol ez a spec nem mond mást, a mai viselkedés marad.

## A cél egy mondatban

A futás három Telegram-üzenetéből (Sorba került, Elkezdődött, hiba) kiderül, melyik elemről van szó (#274), és a recept → modell hozzárendelés Telegramról, a serve újraindítása és a YAML szerkesztése nélkül állítható egyszeri vagy állandó móddal (#292).

## Miért egy spec, és miért két ütem

Mindkét issue ugyanazt a három üzenetsort érinti (`runQueuedLine`, `runStartedLine`, `runFailedLine` a `runLabel`-en át, `worker/src/messages.ts`), így az üzenet formátumát egyben kell kitalálni. A kód két ütemben, két külön kód-PR-ben és két kiadásban készül:

1. **#274 címke.** Csak a Worker változik, a serve nem.
2. **#292 modellváltás.** D1-migráció, `/model` parancs, `GET /models` a serve-ben, `models` mező a kopogtatásban, YAML-jelző.

## Mért kiinduló állapot (2026-10-22)

- A futásüzenetek hat hívóhelyén (`worker/src/handle.ts:538, 563, 589, 598, 688, 757`) a `row: JobRow` mindenhol elérhető, benne a `videoId` és a `title`. Futás csak `ready` sorra indul (`handle.ts:717`), a `title` pedig a ready-visszahívásban kerül a sorba (`handle.ts:644`), szöveges tételnél már beérkezéskor. **A serve-ből nem kell semmit átadni.**
- A Worker `videoId`-ja a vault `item_id`-ja: videónál a YouTube-azonosító (`src/source/identity.ts`), szöveges tételnél `t-<16 hex>` (`src/source/text-core.ts:131`). A kész üzenet linkje is ezt használja (`worker/src/plan.ts:143`).
- A Telegram ma is fogad `.txt` és `.md` csatolmányt, valamint `/scan` szöveget (#206, `handle.ts:120`). Dokumentum-bemenethez nem kell külön szelet.
- A serve minden kérésnél újraolvassa a configot (`src/serve/summary.ts:110`).
- A konténerben a config mappa **csak olvasható** (`.:/app/config:ro`, homelab `services/refinery/docker-compose.yml`), ezért Telegramról a YAML nem írható.
- A LiteLLM `/model/info` `supports_response_schema` mezője **megbízhatatlan**. A `sub2api--gemini-3.8-flash-high` értéke `True`, élesben mégis elbukott mindhárom sémás recepten (2026-10-08). Sémás modell kiválasztására ez a mező nem használható.
- A fordítórecept nem sémás (`src/recipe/translate.test.ts:64`).
- A futás azonosítója `jobId:recept`, a modell nincs benne (`plan.ts:111`). Ha egy recept kész és értesített, az újranyomása `resend` (`plan.ts:56`). A serve a kész receptet a `force` nélkül kihagyja (`src/pipeline.ts:435`).
- A jegyzet frontmatterje a ténylegesen futott modellt rögzíti (`src/vault/render.ts:100`).
- A peter-mba configjában `judge_enabled: false`, és a `model.recipes` a `notes`, `flashcards`, `bloom` és `clean-deep` receptet állítja `sub2api--claude-sonnet-5-5`-re.

## Ezen a körön kívül

- Kész recept újragenerálása más modellel. A modellváltás csak a még nem futott receptekre hat; a kész receptre a gomb ma is a régi linket küldi. Ha kell, külön szelet: receptenkénti `force` a kopogtatásban és a pipeline-ban.
- A `draft` és a `judge` szerep állítása Telegramról.
- Fordítás modellje nyelvenként vagy forrásreceptenként.
- Terminálos `refinery run --model …` kapcsoló. Nem zárja ki semmi, ugyanazt a befésülést hívná.
- A felirat-job üzenetei (`queuedLine`, `waitingLine`, `readyLine`).
- A #229 (a megszakított futás késői visszahívása). A `models` mező csak kiegészíti a kopogtatást, a #229 próbálkozás-azonosítóját nem érinti.

## Döntések a tervezésből

| Kérdés | Döntés | Kié |
|---|---|---|
| Hatókör | Egy spec, két ütem, két kód-PR: #274, utána #292. | felhasználó |
| Hol él a felülírás? | A Worker D1-ében. A futás sora rögzíti a kért modellt, a kopogtatás `models` mezőben viszi, a serve a futás idejére befésüli, és nem tárol semmit. | felhasználó |
| Mi választható, és honnan tudható, hogy egy modell sémás? | Egy kifejezett lista a YAML-ban: `model.switchable`, modellenként `structured` vagy `text`. A tervezés közben derült ki, hogy a „minden árazott modell" a peter-mba-n kb. 80 modellt jelentene, köztük nem szövegmodelleket. | felhasználó |
| Mikor látszik a modell az üzenetben? | Csak felülíráskor. A YAML-alapot a Worker nem ismeri. | felhasználó |
| Mi állítható? | A 8 alaprecept, és egy közös beállítás a fordításra. A `draft` és a `judge` nem. | felhasználó |
| A fordítás felülírása | Egy modell minden fordításra, a forrásrecepttől és a nyelvtől függetlenül. | felhasználó |
| Mire szól az „egyszeri"? | A következő létrejövő futásra, amely az adott receptet (vagy fordítást) tartalmazza. Ha egy futásban több recept van, az egyszeri beállítás a futás létrejöttekor fogy el. | tervező, jóváhagyva |
| Kész recept újranyomása | Marad a mai `resend`, és az egyszeri felülírás ilyenkor nem fogy el. | felhasználó |
| A `/model` kezelése | Gombokkal: recept → modell → mód. | felhasználó |
| A YAML `model.recipes` ellenőrzése a jelzőre | Nem. Csak a Telegram-felülírást ellenőrizzük, a meglévő configok változtatás nélkül működnek. | tervező |

## 1. ütem — #274: elemcímke a futásüzenetekben

### Ma

```
Sorba került: notes
Elkezdődött a feldolgozás: notes, bloom → hu. Hamarosan jelzem az eredményt.
notes: <hiba>
```

### Új viselkedés

A három üzenet közös címkét kap, `[<item_id>] <cím>: <receptek>[ → <nyelv>]`:

```
Sorba került [dQw4w9WgXcQ] Hogyan működik a GPS: notes
Elkezdődött a feldolgozás [dQw4w9WgXcQ] Hogyan működik a GPS: notes, bloom → hu. Hamarosan jelzem az eredményt.
[t-1a2b3c4d5e6f7a8b] eloadas-jegyzet: notes: <hiba>
```

- `item_id` = `row.videoId`.
- A cím `row.title`, `flatTitle`-lel. 60 karakter fölött 59 karakterre vágva, `…`-ra végződve. Ha a cím `null`, csak az `[<item_id>]` marad, kettőspont előtti cím nélkül.
- A `runLabel` a sort is megkapja. Mind a hat hívóhely ugyanazt a címkét adja, a késői, megszakított futás hibaüzenete is (`handle.ts:563`).

### Elfogadási feltételek

- YouTube-elemen a `notes` gombra a „Sorba került [<11 jelű azonosító>] <videócím>: notes" üzenet jön, az elfogadás után pedig az „Elkezdődött a feldolgozás [<azonosító>] <videócím>: notes. …".
- Csatolt `.md` fájlnál az üzenetben a `t-…` azonosító és a fájl alapneve áll.
- Egy 100 karakteres címből 60 karakter látszik, az utolsó a `…`.
- A hibaüzenet (a serve `failed` visszahívása, illetve a hiányzó jegyzetlink) ugyanazzal a címkével kezdődik, utána jön a hiba szövege.
- A meglévő Worker-tesztek az új szöveggel zöldek, a serve kódja nem változik.

## 2. ütem — #292: receptenkénti modellváltás Telegramról

### Config: `model.switchable`

```yaml
model:
  # Telegramról ezekre lehet váltani. Mindnek kell ár. A structured sémás JSON-t ad,
  # csak ilyen választható a notes, a flashcards és a bloom receptre.
  switchable:
    sub2api--claude-sonnet-5-5: structured
    sub2api--claude-opus-5-5: structured
    sub2api--grok-4.7: text
    sub2api--gemini-3.8-flash-high: text
```

- Miért külön lista, és miért nem minden árazott modell: a peter-mba `pricing`-jében kb. 80 modell áll, köztük hang-, kép- és embedding-modellek is (`tts-1`, `grok-imagine-image-2.0`, `text-embedding-3-small`). Ebből nem lehet gomblistát csinálni.
- A `model.switchable` nem kötelező, alapból üres. Üres listánál a `/model` kiírja a hozzárendelést, de a receptgombokra „nincs választható modell" a válasz.
- Az érték `structured` vagy `text`, más érték config-hiba. Ha egy felsorolt modellnek nincs ára, az is config-hiba, ugyanúgy, mint a `model.recipes`-nél.
- Sémás receptre (`notes`, `flashcards`, `bloom`, és minden recept, amelynek van `structured` kimenete) csak `structured` modell választható. Minden más receptre és a fordításra bármelyik `switchable` modell.
- **Telepítési teendő:** a peter-mba configja megkapja a `model.switchable` listát. Enélkül a `/model` nem kínál modellt.

### Serve: `GET /models`

- Bearer-titokkal, mint a `/status`. A configot a kérés pillanatában olvassa (`loadCliConfig` + `loadModelConfig`).
- Válasz:
  ```json
  {
    "draft": "sub2api--grok-4.7",
    "recipes": { "notes": "sub2api--claude-sonnet-5-5" },
    "models": [{ "name": "sub2api--claude-sonnet-5-5", "structured": true }],
    "structuredRecipes": ["notes", "flashcards", "bloom"]
  }
  ```
- Ha a config nem tölthető be, a válasz 503, a Worker pedig a mostani „A szerver nem válaszol" mintájú mondatot küldi.

### Serve: a `models` mező a kopogtatásban

- `ServeJob.models?: Record<string, string>`: receptazonosító → modell, a futás tényleges azonosítóival (`notes`, illetve fordításnál `notes-hu`). Az `isJob` csak szöveg → szöveg objektumot fogad el, különben 400.
- A futás előtt a serve a `raw.model.recipes`-be fésüli. Utána a meglévő ellenőrzések futnak: az ár (`loadModelConfig`) és a receptkulcs (`assertRecipeModels`). Új ellenőrzésként a modellnek szerepelnie kell a `switchable`-ben, sémás receptnél `structured` jelzéssel. Ha bármelyik bukik, a futás a mai hibaúton `failed` lesz, a hiba első sorával. A Telegramon így jelenik meg: `[<id>] <cím>: notes (<modell>): pricing: nincs ára …`.
- A futásnapló `run:started` parancssora tartalmazza a felülírást, például `serve recipes notes=sub2api--claude-sonnet-5-5`. A jegyzet frontmatterjében a `model` mező már ma a ténylegesen futott modell.

### Worker: tárolás

- Új D1-tábla `model_overrides (sub, recipe, mode, model)`, elsődleges kulcs `(sub, recipe, mode)`. A `mode` értéke `once` vagy `always`, a `recipe` a 8 alaprecept egyike, vagy `translate` a fordításra. Egy receptre egyszerre lehet egyszeri és állandó sor is.
- A `runs` tábla új oszlopot kap: `model TEXT` (null, ha nincs felülírás). Egy alaprecept-futás egy receptet tartalmaz, fordításnál egyetlen közös beállítás van, így futásonként legfeljebb egy modell kell.
- A `requestRun` a futás létrehozásakor (`insertRun`, illetve újrapróbánál `claimRun`) választ modellt:
  - alapreceptnél a recept `once` sora, ha van, különben az `always` sora;
  - fordításnál ugyanez a `translate` kulccsal.
  
  A felhasznált `once` sor ugyanekkor törlődik. A `busy`, a `resend` és az `ignore` nem fogyaszt.
- A `knockFor` a `run.model`-ből építi a `models` mezőt a futás összes fajtájára (`runKinds`). A cron újrakopogtatása így ugyanazt a modellt viszi.
- A már elfogadott vagy futó futást a későbbi `/model` nem érinti.

### Worker: a `/model` parancs

Csak összekötött, engedélyezett felhasználónak (`allowedBinding`). A többieknek a mai `BIND_FIRST` válasz jár.

1. `/model`: a Worker lekéri a `GET /models`-t, és kiírja a hozzárendelést receptenként:
   - `notes: sub2api--claude-sonnet-5-5 (állandó)`, ha a felhasználónak van felülírása;
   - `summary: sub2api--grok-4.7`, ha nincs, ilyenkor a YAML szerinti érték, a `recipes` értéke vagy a `draft`;
   - a fordításnál, felülírás nélkül: `fordítás: a config szerint`.
   
   Ha mindkét felülírás van, mindkettő látszik, az egyszeri van elöl. Alatta receptenként egy gomb, és egy `fordítás` gomb.
2. Receptre koppintva a Worker újra lekéri a `GET /models`-t, és az üzenetet a választható modellekre szerkeszti: sémás receptnél csak a `structured` modellekre. Alul egy `visszaállítás` gomb, ha van felülírás.
3. Modellre koppintva: `egyszeri` és `állandó` gomb.
4. Módra koppintva: a D1-be írás, és az üzenet egy megerősítésre szerkesztődik, például „notes: sub2api--claude-sonnet-5-5, egyszeri. A következő notes-futás ezzel megy."
5. A `visszaállítás` a recept mindkét felülírását törli.

- A gombadat legfeljebb 64 bájt (Telegram). Ha egy modellnév ebbe nem fér bele, a modell nem kerül a listára, és a Worker naplóz róla.
- A gombadat nem megbízható bemenet. A Worker csak az ismert recepteket fogadja el, a modellt pedig a serve ellenőrzi a futáskor (ár, `switchable` tagság, `structured` jelzés).
- Ha a serve nem érhető el, a `/model` és a lista nem jelenik meg, a válasz a mai `probeFailure` mondata. Ilyenkor beállítani sem lehet. Ez tudatos, mert a választható lista a serve configjából jön.
- A `HELP_TEXT` kap egy sort: `/model – a receptek modelljének megtekintése és váltása`.

### Üzenet a felülírt futásról

A címke a modellel bővül, csak ha a futásnak van `model` értéke:

```
Sorba került [dQw4w9WgXcQ] Hogyan működik a GPS: notes (sub2api--claude-sonnet-5-5)
Elkezdődött a feldolgozás [dQw4w9WgXcQ] Hogyan működik a GPS: notes, bloom → hu (sub2api--claude-sonnet-5-5). Hamarosan jelzem az eredményt.
```

A mód (egyszeri vagy állandó) a futásüzenetben nem látszik, csak a `/model` kiírásában.

### Elfogadási feltételek

- `/model` → `notes` → `sub2api--claude-sonnet-5-5` → `egyszeri`, utána egy új videón a `notes` gombra:
  - a Sorba került üzenetben ott van a `(sub2api--claude-sonnet-5-5)`;
  - a kész jegyzet frontmatterjében `model: sub2api--claude-sonnet-5-5` áll;
  - a következő új videó `notes` futása már a YAML szerinti modellel megy, zárójel nélkül.
- Ugyanez `állandó` móddal: a peter-mba konténer újraindítása után is a felülírt modell fut, amíg a `visszaállítás` meg nem történik.
- Egyszeri és állandó felülírás együtt: az első futás az egyszerivel megy, a második az állandóval.
- Ha a `notes` egy videón már kész, az újranyomás a régi linket küldi, és az egyszeri felülírás megmarad a következő új futásra.
- `/model` → `notes` listájában csak a `switchable` `structured` modelljei szerepelnek. A `summary` listájában a `switchable` minden modellje, és semmi más a `pricing`-ből.
- A `fordítás` felülírása után egy `notes, bloom → hu` futás mindkét fordítást a felülírt modellel készíti. A `notes` alaprecept-futását a fordítás felülírása nem érinti.
- Kézzel összerakott kopogtatás olyan modellel, amely nincs a `switchable`-ben, vagy amely sémás receptre nem `structured`: a futás `failed`, és a Telegram-üzenet megmondja, miért.
- Nem összekötött felhasználónál a `/model` a `BIND_FIRST` választ adja, és nem kérdezi le a serve-et.
- A serve újraindítása nélkül a YAML-ban átírt `model.recipes` a következő `/model` kiírásban már látszik.

## Nyitott pontok a tervhez

- A `GET /models` a serve kapuját (`gate`) nem foglalja, futás közben is válaszol. A terv ellenőrzi, hogy a config újraolvasása futás közben nem zavarja-e a futást.
- A D1-migráció száma (`0006_…`) és a `runs.model` oszlop visszafelé kompatibilis: a régi sorokban `NULL`.
