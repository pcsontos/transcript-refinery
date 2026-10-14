# Spec — Telegram-parancsok és a `/cancel` (#220, bővítve)

**Dátum:** 2026-10-14 · **Státusz:** átnézésre vár

Ez a dokumentum a #220 bővített tervezéséből készült. Az issue a futó vagy sorban álló job megszakítását kérte a Telegramból; a tervezés közben négy további parancs került a körbe (`/help`, `/ping`, `/version`, `/status`), mert ugyanazt a parancs-elosztót és ugyanazt a serve-elérést igénylik. Ahol ez a spec nem mond mást, a mai viselkedés marad.

## A cél egy mondatban

A Telegram-botból megszakítható a saját, sorban álló vagy futó munka (`/cancel`), és a bot négy tájékoztató parancsot is ismer (`/help`, `/ping`, `/version`, `/status`).

## Háttér: mi van ma (a kódból ellenőrizve)

- A Worker (`worker/src/handle.ts`) a szöveges üzenetet a `/start` kivételével a `linesForMessage`-nek adja; parancsot és megszakító gombot nem ismer. A gombok (`parseTap`, `worker/src/plan.ts`) recept-, fordítás-, váltó- és nyelvgombok.
- A jobok és a receptfutások állapota `queued | waiting | accepted | ready | failed` (`worker/src/store.ts`). A D1-ben a `status` sima `TEXT` oszlop, `CHECK` nélkül, tehát új érték migráció nélkül bevihető.
- A cron (`handleCron`, `due`) a `queued` és `waiting` sorokat újra kopogtatja, az `accepted` sort 15 perc után.
- A serve (`src/serve/http.ts`) egyetlen munkát futtat egyszerre (`ServeGate.current`, a többi `409`). Végpontjai: `GET /ping`, `GET /version` (titok nélkül), `GET /status` (titokkal: `{version, busy}`), `GET /notes…`, `POST /jobs`. Megszakító végpontja nincs.
- A `runJob` és a `runRecipes` a serve folyamatán belül fut. A `commandRun` egységhurkában (`src/cli.ts`) a költségplafon `break`-kel áll meg, majd a `finish` a kész jegyzeteket commitolja; `AbortSignal`-t a futás nem kap, a megszakítás ma csak a folyamat SIGINT-je.
- A `runRecipes` (`src/serve/summary.ts`) a `commandRun` visszatérése után jegyzetenként commitol, majd pusholja a vaultot, a kilépési kódtól függetlenül.
- Minden regisztrált recept `maxIterations: 0`, tehát egy egység egyetlen generálás és bírálat.
- A `settle` (`handle.ts`) jelenleg feltétel nélkül menti a sort a kopogtatás után, a `handleCallback` pedig minden nem `failed` visszahívást `ready`-nek vesz.

## Ezen a körön kívül

- A Telegram parancsmenüje (`setMyCommands`): a `/help` felsorolja a parancsokat, a menü külön kérésre jöhet.
- A Worker verziója: a `/version` csak a serve verzióját mutatja, mert a Workernek ma nincs saját verziószáma, és ahhoz új build-lépés kellene.
- Azonnali megszakítás (a futó `yt-dlp` vagy LLM-hívás leállítása, gyerekfolyamat és `kill`): a B szint tudatosan nem ezt adja, lásd lent.
- Több felhasználó vagy csoportos chat: a bot továbbra is csak privát chatre készült.
- A web UI (#205) vezérlése.

## Döntések a tervezésből

| Kérdés | Döntés |
|---|---|
| Mit jelent a futó job megszakítása? | B szint: a serve a következő lépéshatáron áll meg. Az éppen futó `yt-dlp`, feltöltés vagy LLM-hívás befejeződik, utána nem indul újabb. |
| Több nyitott job esetén mit érint a `/cancel`? | Gombos lista a nyitott jobokról, plusz "Mind megszakítása". A gomb a jobot és a nyitott receptfutásait együtt érinti. |
| Új állapot? | Igen: `cancelled`, a `JobStatus`-ban. Migráció nem kell. |
| Mi van, ha a serve nem érhető el? | Az állapot csak a serve megerősítése után lesz `cancelled`; különben `accepted` marad, és a bot újrapróbálást kér. |
| Mi van az addig elkészült kimenettel? | Megmarad és commitolódik, a terminál SIGINT-viselkedésével egyezően. |
| Hogyan állítja le a serve a futást? | `AbortSignal` a receptfutás egységhurkában, a meglévő plafon-`break` mintáján. A felirat-job nem figyeli a signalt. |
| Kell új visszahívás-típus? | Nem. A serve a mai `ready`/`failed` visszahívást küldi; a megszakítás költsége a `failed` hibasorában jön (`failureLine`). |
| Újraindítható a megszakított recept? | Igen, a gomb úgy indítja újra, mint a `failed` futást. |
| Jogosultság | Csak a saját (`row.sub`) jobok szakíthatók meg, ahogy a `handleTap`-nál. |
| `/version` | Csak a serve verziója. |
| `/status` | A serve verziója és `busy` értéke, plusz a nyitott jobok és receptfutások száma a D1-ből. |
| `/ping` | A serve elérhetősége és a válaszidő. |
| `/help` | Statikus szöveg; kötés nélkül is megy. A többi parancs kötést igényel. |

## 1. Worker: parancsok

A `handleUpdate` a `/start` ellenőrzése után, de a `linesForMessage` előtt felismeri az `^/(help|cancel|ping|version|status)(@botnév)?\s*$` alakú üzenetet. A parancs nem hoz létre jobot, és az üzenetnek nincs argumentuma.

- **Jogosultság:** a `/help` kötés nélkül is megy, és utal a `/start`-ra. A többi parancs kötés nélkül a meglévő `BIND_FIRST` választ kapja.
- **Ismeretlen `/parancs`:** a mai viselkedés marad: a `linesForMessage` a tokent kihagyja, a válasz "Nincs YouTube-videó az üzenetben."
- **Ismételt webhook:** a parancsok a `/start`-hoz hasonlóan a `rememberUpdate`-tel szűrik az ismételt `update_id`-t.
- **A serve elérése:** a `WorkerDeps` két új függvényt kap, amelyeket az `index.ts` a `SERVE_URL`-ből és a titokból épít, a `reader.ts` időkorlátjával (10 s):
  - `probe()`: `GET /status` a titokkal, mért válaszidővel. Kimenete `{ok: true, ms, version, busy}`, `{ok: false, reason: 'secret'}` (`401`) vagy `{ok: false, reason: 'down'}` (minden más).
  - `cancel(id)`: `POST /jobs/<id>/cancel` (az azonosító URL-kódolt). Kimenete `ok` (`200`), `unknown` (`404`) vagy `unreachable` (hálózati hiba, időtúllépés, minden más státusz).
- **Válaszok** (mindhárom a `probe()`-ból):
  - `/ping`: "A szerver él (123 ms)."
  - `/version`: "A szerver verziója: 1.16.0."
  - `/status`: a serve verziója és `busy` értéke, a D1-ből a nyitott jobok és receptfutások száma (`queued`, `waiting`, `accepted`). Ha a serve nem érhető el, a D1-ből származó számok így is megjelennek.
  - Ha a serve nem érhető el: "A szerver nem válaszol." Titokeltérésnél a meglévő `SERVE_SECRET_MISMATCH` szöveg.
  - `/help`: a parancsok listája és egy sor arról, hogy YouTube-linket kell küldeni. A pontos szöveg a tervben dől el.
- **Közös lekérdezés:** a `JobStore` kap egy új metódust (pl. `openFor(sub)`), amely a felhasználó nyitott jobjait és receptfutásait adja. Ebből épül a `/cancel` lista és a `/status` számláló. Megvalósítás a `memoryStore`-ban és a D1-ben (`worker/src/d1.ts`).

## 2. Worker: a `/cancel` folyamata

### Lista

A `/cancel` a felhasználó (`sub`) jobjait listázza, ha a jobnak nyitott állapota van (`queued`, `waiting`, `accepted`), vagy van nyitott receptfutása (ez egy `ready` jobra is igaz lehet). Jobonként egy gomb jelenik meg a címmel (ha nincs, a videóazonosítóval), alatta egy "Mind megszakítása" gomb. Ha nincs nyitott munka: "Nincs megszakítható munka."

### Gomb

A `parseTap` kap egy `cancel` típust: `c:<jobId>` egy jobra, `c:*` mindre. A `jobId` (`<update_id>:<videóazonosító>`) belefér a Telegram 64 bájtos `callback_data` korlátjába. A koppintás ellenőrzi a kötést és a `row.sub`-ot.

### Állapot

A `JobStatus` kap egy `cancelled` értéket. A `due`, az `isDue` és az `activeByVideo` nem tekinti nyitottnak, tehát a cron nem kopogtatja, és ugyanarra a videóra új job indulhat. A `decideRun` a `cancelled` futást a `failed`-hez hasonlóan újraindíthatónak veszi (`retry`); a `requestRun` a futás tényleges állapotából (`failed` vagy `cancelled`) állítja vissza `queued`-ra.

### Elemenként a döntés

Az állapotírás feltételes (`WHERE status = ?`), így a második megszakítás hatástalan.

| Állapot | Mit tesz a Worker |
|---|---|
| `queued`, `waiting` | A serve-nek nem szól; azonnal `cancelled`. |
| `accepted` | `cancel(id)` a serve felé. `ok` és `unknown`: `cancelled` (az `unknown` azt jelenti, hogy a serve újraindult, vagy a job már lefutott, nincs mit leállítani). `unreachable`: az állapot `accepted` marad, a bot újrapróbálást kér. |
| `ready`, `failed`, `cancelled` | Nincs változás; a bot jelzi, hogy nincs mit megszakítani. |

### Futási verseny

A `settle` ma feltétel nélkül menti a sort. Ha a koppintással egy időben jön a cron kopogtatása és a serve `202`-t ad, a `settle` visszaírhatná `accepted`-et a `cancelled` helyére, a serve pedig futna tovább. Ezért:
- A `save` és a `saveRun` soha nem ír felül `cancelled` sort, és visszaadja, hogy az írás hatott-e.
- Ha a `settle` `202`-t kapott, de a sor közben `cancelled` lett (a mentés nem hatott, vagy a futás `claimRun`-ja azért vesztett), a Worker utólag meghívja a serve cancel végpontját.

### Visszahívás

A serve a mai `ready` vagy `failed` visszahívást küldi, új típus nincs.
- **Felirat-job `cancelled` soron:** a visszahívás elnyelődik (nincs állapotírás, nincs üzenet).
- **Receptfutás `cancelled` soron:** a Worker a visszahívást állapotváltozás nélkül egy üzenetként továbbítja: `failed` esetén a `runFailedLine` sort (a megszakításnál ebben van a költség: "A futás megállt: megszakítva (0.0040 $ / 5.0000 $)"), `ready` esetén a `runReadyMessage` linkjeit (ha a futás a megszakítás előtt végzett). A serve visszahívásonként egyszer küld, és a `cancelled` futást a cron nem kopogtatja, ezért külön egyszeriség-jelző nem kell.

### Visszajelzés

A koppintásra a bot azonnal válaszol: "Megszakítva: [cím]." A pontos szövegek a tervben vannak.

## 3. Serve: a megszakítás

### Végpont

`POST /jobs/<id>/cancel`, ugyanazzal a Bearer-titokkal, mint a többi végpont (rossz vagy hiányzó titoknál `401`).
- A `ServeGate` a `current` mellé kap egy opcionális `abort?: AbortController` mezőt. A `handle` a friss job elfogadásakor hozza létre, a `signal`-ját az `onJob` második paramétereként adja át, és a `finally` a `current`-tel együtt törli.
- Ha a `gate.current === id`, a végpont `abort()`-ol és `200`-at ad (ismételt hívásra is, amíg a job fut). Ha a `current` más, vagy a kaput nem job foglalja (pl. a `notes` lekérés), `404`.
- A `200` azt jelenti, hogy a jelzés megérkezett, nem azt, hogy a futás már megállt. A kapu a futás leállásáig foglalt marad; a Worker ezt a meglévő `409` útvonalon kezeli.
- A kérés naplózódik (`[serve] POST /jobs/<id>/cancel -> <státusz>`).

### Megszakítási pont

- **Receptfutás:** a signal a `runJob` → `refine` → `runRecipes` → `commandRun` (runtime `signal`) úton jut a hurokig. Az egységhurok elején, a `processItem` előtt a `signal.aborted` esetén kibocsát egy `run:aborted` eseményt (`reason: "megszakítva"`, `spentUsd` a költségőrből), a hátralévő egységeket a plafon-ághoz hasonlóan kihagyottnak jelöli, és kilép a hurokból. A meglévő `finish` ezután lefut. Mivel minden recept `maxIterations: 0`, az egységhatár gyakorlatilag a hívás határa; ha a konfig `maxIterations`-t emel, a futó egység a javítókörökkel együtt befejeződik (ismert korlát). Az első egység előtt érkező megszakítás nulla modellhívást jelent, ezért a `refine` előtt nem kell külön ellenőrzés.
- **Felirat-job (`runJob` felirat-ága):** nem figyeli a signalt. A `yt-dlp` és az R2-feltöltés lefut, a visszahívást a Worker elnyeli. Ismert korlát: a kapu a letöltés végéig foglalt; ha ez zavar, későbbi körben pótolható.

### A `runRecipes` megszakítás után

Nincs új kód: a hurok `break`-je után a `commandRun` kódja 0, a meglévő jegyzetenkénti commit és push lefut, a hiányzó jegyzet miatt a meglévő `failureLine` a `run:aborted` eseményből ezt adja: "A futás megállt: megszakítva (0.0040 $ / 5.0000 $)". Ha minden kért jegyzet a megszakítás előtt elkészült, az eredmény `ok: true`. A serve ezt a mai `failed`/`ready` visszahívással küldi. A naplóban a megszakítás külön sorral jelenik meg (`[serve] POST /jobs/<id>/cancel -> 200`).

## 4. Hibakezelés

- **Sorrend:** serve cancel (ha kell), feltételes `cancelled` írás, üzenet. Ha az üzenet küldése elbukik, a sor `cancelled` marad, és a hiba naplózódik.
- **Dupla koppintás és régi gomb:** a feltételes írás miatt hatástalan; a bot: "Ez már lefutott vagy meg lett szakítva." A `rememberUpdate` ugyanazt a frissítést kétszer nem dolgozza fel.
- **Más felhasználó jobja:** nem változik semmi, és nincs visszajelzés a job létezéséről.
- **A serve nem érhető el** (`/ping`, `/version`, `/status`): "A szerver nem válaszol."

## 5. Tesztek (megfigyelhető viselkedés)

A meglévő `*.test.ts` mintára, a `memoryStore`-ral és hamis klienssel.

**Worker**
1. `/cancel` nyitott munka nélkül: "Nincs megszakítható munka."
2. A lista csak a saját nyitott munkákat mutatja.
3. `queued` megszakítása után a sor `cancelled`, nem megy ki `knock`, és a `handleCron` sem kopogtatja.
4. `accepted` megszakítása: a serve `ok` és `unknown` esetén `cancelled`; `unreachable` esetén `accepted` marad és újrapróbálást kér.
5. Dupla koppintás: a második hatástalan.
6. Futási verseny: a `settle` `202`-je nem írja felül a `cancelled` sort, és a Worker utólag meghívja a serve cancel végpontját.
7. Felirat-job `cancelled` soron a `ready` és `failed` visszahívás nem ír állapotot és nem küld üzenetet; receptfutás `cancelled` soron a `failed` visszahívás egy hibasort, a `ready` a linkeket küldi, az állapot `cancelled` marad.
8. Más felhasználó jobjára a koppintás nem változtat semmit.
9. `/help` kötés nélkül is megy; a többi parancs kötés nélkül `BIND_FIRST`-et ad.
10. `/ping`, `/version`, `/status` működő, nem elérhető és titokeltérő serve mellett; a `/status` a D1-ből számolja a nyitott munkákat.
11. A megszakított receptfutás a receptgombbal újraindul.

**Serve**
1. `POST /jobs/<id>/cancel`: futó jobra `200` (ismételve is), és a futó `onJob` signalja megszakad; más azonosítóra és a `notes` foglalta kapura `404`; titok nélkül `401`.
2. `runRecipes` két recepttel, az első egység után megszakítva: a második egységre nincs modellhívás, az első jegyzet commitolva van, az eredmény `ok: false` a "megszakítva" költségsorral.
3. `commandRun` indulás előtt megszakítva: nulla modellhívás, `run:aborted` esemény `reason: "megszakítva"`.
4. A `runJob` a receptjob signalját a `refine`-nak adja tovább.

**Kézi próba az élő környezetben:** a peter-mba-n kétreceptes futást indítani, kiadni a `/cancel`-t, és ellenőrizni: a serve naplója leállást mutat, a `/status` `busy` értéke visszaáll `null`-ra, és a vaultban csak a kész jegyzet van.

## 6. Kiadás

Minor verzióemelés és changelog PR-en át, tag, majd a konténerkép kiadása és a Worker telepítése a bevált menet szerint. **A sorrend számít:** előbb a serve (a peter-mba frissítése az új képpel), utána a Worker. Ha a Worker lenne előbb, az új Worker a régi serve-nek küldene cancel kérést; az `404`-et adna, a Worker `unknown`-nak venné, `cancelled`-re állítaná a jobot, miközben a serve futna tovább. A fordított sorrend ártalmatlan, mert a régi Worker nem küld cancel kérést.

A `docs/operations/telegram-worker-topology.md` kapja meg az új végpontot és a parancsokat.

## Nyitott pontok a tervhez

- A parancsok és a visszajelzések pontos szövegei: a tervben.
- A #220 címének és törzsének frissítése a spec jóváhagyása után (a `/help`, `/ping`, `/version`, `/status` és a döntések belekerülnek).
