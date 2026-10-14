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
| Hogyan állítja le a serve a futást? | `AbortSignal` a lépéshatáron, a meglévő plafon-`break` mintáján. |
| Jogosultság | Csak a saját (`row.sub`) jobok szakíthatók meg, ahogy a `handleTap`-nál. |
| `/version` | Csak a serve verziója. |
| `/status` | A serve verziója és `busy` értéke, plusz a nyitott jobok és receptfutások száma a D1-ből. |
| `/ping` | A serve elérhetősége és a válaszidő. |
| `/help` | Statikus szöveg; kötés nélkül is megy. A többi parancs kötést igényel. |

## 1. Worker: parancsok

A `handleUpdate` a `/start` ellenőrzése után, de a `linesForMessage` előtt felismeri az `^/(help|cancel|ping|version|status)(@botnév)?\s*$` alakú üzenetet. A parancs nem hoz létre jobot, és az üzenetnek nincs argumentuma.

- **Jogosultság:** a `/help` kötés nélkül is megy, és utal a `/start`-ra. A többi parancs kötés nélkül a meglévő `BIND_FIRST` választ kapja.
- **Ismeretlen `/parancs`:** a mai viselkedés marad.
- **A serve elérése:** a `WorkerDeps` kap egy `serve` objektumot, amelyet az `index.ts` a `SERVE_URL`-ből és a titokból épít, a `reader.ts` időkorlátjával:
  - `ping()`: `GET /ping`, válaszidővel (ms).
  - `status()`: `GET /status`, `{version, busy}` vagy `null`, ha nem érhető el.
  - `cancel(id)`: `POST /jobs/<id>/cancel` (az azonosító URL-kódolt). Kimenete `ok` (`200`), `unknown` (`404`) vagy `unreachable` (hálózati hiba, időtúllépés, `5xx`, `401`; `401`-nél naplózva).
- **Válaszok:**
  - `/ping`: "A szerver él (123 ms)." vagy "A szerver nem válaszol."
  - `/version`: a serve verziója, vagy a "nem válaszol" üzenet.
  - `/status`: a serve verziója és `busy` értéke, a D1-ből a nyitott jobok és receptfutások száma (`queued`, `waiting`, `accepted`). Ha a serve nem érhető el, a D1-ből származó számok így is megjelennek.
  - `/help`: a parancsok listája és egy sor arról, hogy YouTube-linket kell küldeni. A pontos szöveg a tervben dől el.
- **Közös lekérdezés:** a `JobStore` kap egy új metódust (pl. `openFor(sub)`), amely a felhasználó nyitott jobjait és receptfutásait adja. Ebből épül a `/cancel` lista és a `/status` számláló. Megvalósítás a `memoryStore`-ban és a D1-ben (`worker/src/d1.ts`).

## 2. Worker: a `/cancel` folyamata

### Lista

A `/cancel` a felhasználó (`sub`) jobjait listázza, ha a jobnak nyitott állapota van (`queued`, `waiting`, `accepted`), vagy van nyitott receptfutása (ez egy `ready` jobra is igaz lehet). Jobonként egy gomb jelenik meg a címmel (ha nincs, a videóazonosítóval), alatta egy "Mind megszakítása" gomb. Ha nincs nyitott munka: "Nincs megszakítható munka."

### Gomb

A `parseTap` kap egy `cancel` típust: `c:<jobId>` egy jobra, `c:*` mindre. A `jobId` (`<update_id>:<videóazonosító>`) belefér a Telegram 64 bájtos `callback_data` korlátjába. A koppintás ellenőrzi a kötést és a `row.sub`-ot.

### Állapot

A `JobStatus` kap egy `cancelled` értéket. A `due`, az `isDue` és az `activeByVideo` nem tekinti nyitottnak, tehát a cron nem kopogtatja, és ugyanarra a videóra új job indulhat.

### Elemenként a döntés

Az állapotírás feltételes (`WHERE status = ?`), így a második megszakítás hatástalan.

| Állapot | Mit tesz a Worker |
|---|---|
| `queued`, `waiting` | A serve-nek nem szól; azonnal `cancelled`. |
| `accepted` | `serve.cancel(id)`. `ok` és `unknown`: `cancelled` (az `unknown` azt jelenti, hogy a serve újraindult, vagy a job már lefutott, nincs mit leállítani). `unreachable`: az állapot `accepted` marad, a bot újrapróbálást kér. |
| `ready`, `failed`, `cancelled` | Nincs változás; a bot jelzi, hogy nincs mit megszakítani. |

### Futási verseny

A `settle` ma feltétel nélkül menti a sort. Ha a koppintással egy időben jön a cron kopogtatása és a serve `202`-t ad, a `settle` visszaírhatná `accepted`-et a `cancelled` helyére, a serve pedig futna tovább. Ezért:
- A `save` és a `saveRun` soha nem ír felül `cancelled` sort.
- Ha a mentés ezért nem hat (a `settle` `202`-t kapott, de a sor közben `cancelled` lett), a Worker utólag meghívja a serve cancel végpontját.

### Visszahívás

A `handleCallback` és a `runCallback` `cancelled` sorra nem ír állapotot és nem küld "kész" értesítést. Egyetlen kivétel: egy `cancelled` visszahívás elkészült jegyzettel (`noteUrl`) egyszer elküldi a "Megszakítva. A `summary` elkészült: [link]" üzenetet; az egyszeriséget a `notified` jelző adja.

### Visszajelzés

A koppintásra a bot azonnal válaszol: "Megszakítva: [cím]", vagy "Megszakítás kérve", ha a futó lépés még befejeződik. A pontos szövegek a tervben dőlnek el.

## 3. Serve: a megszakítás

### Végpont

`POST /jobs/<id>/cancel`, ugyanazzal a Bearer-titokkal, mint a többi végpont (rossz vagy hiányzó titoknál `401`).
- A `ServeGate` a `current` mellé kap egy `abort: AbortController | null` mezőt. A `handle` a friss job elfogadásakor hozza létre, és a `finally` a `current`-tel együtt nullázza.
- Ha a `gate.current === id`, a végpont `abort()`-ol és `200`-at ad (ismételt hívásra is, amíg a job fut). Ha a `current` más, vagy a kaput nem job foglalja (pl. a `notes` lekérés), `404`.
- A `200` azt jelenti, hogy a jelzés megérkezett, nem azt, hogy a futás már megállt. A kapu a futás leállásáig foglalt marad; a Worker ezt a meglévő `409` útvonalon kezeli.
- A kérés naplózódik (`[serve] POST /jobs/<id>/cancel -> <státusz>`).

### Megszakítási pontok

- **Receptfutás:** a `commandRun` runtime kap egy opcionális `signal`-t. Az egységhurok elején, a `processItem` előtt a `signal.aborted` esetén kibocsát egy `run:aborted` eseményt (`reason: "megszakítva"`, `spentUsd` a költségőrből), a hátralévő egységeket a plafon-ághoz hasonlóan kihagyottnak jelöli, és kilép a hurokból. A meglévő `finish` ezután a kész jegyzeteket commitolja. Mivel minden recept `maxIterations: 0`, az egységhatár gyakorlatilag a hívás határa; ha a konfig `maxIterations`-t emel, a futó egység a javítókörökkel együtt befejeződik (ismert korlát).
- **Felirat-munka (`runJob`):** a signal ellenőrzése a `fetchSubtitle` előtt és a feltöltések között. Az éppen futó `yt-dlp` és a már elindult feltöltés befejeződik. Megszakításkor a `forgetWork` takarít. A már feltöltött R2-fájlok maradnak; `info.json` nélkül a `remoteReady` nem tekinti késznek, tehát a következő kérés újra letölt.
- **Receptfutás előtt:** a `runRecipeJob` a fájlok kiírása és a `refine` előtt is ellenőriz.

### A `runRecipes` kimenete megszakítás után

A meglévő jegyzetenkénti commit és push változatlanul lefut. Új kimeneti ág: ha a signal megszakadt, az eredmény `{ok: false, cancelled: true, done, noteUrl?, spentUsd?, note?}`.
- `done`: a kért jegyzetfajták közül a ténylegesen meglévők.
- `noteUrl`: csak akkor kerül bele, ha az átirat és legalább egy jegyzet elkészült.
- `spentUsd`: a futás `run:aborted` eseményéből (a `failureLine` mintájára).
- `note`: ha a push megszakítás után mégis elbukik, itt a hibaszöveg (a commit csak helyben van).

### Visszahívás

A `CallbackBody` mindkét oldalon (`src/serve/job.ts`, `worker/src/handle.ts`) kap egy harmadik alakot: `{status: 'cancelled', noteUrl?, done?, spentUsd?, note?}`. A felirat-munkánál `spentUsd` nincs. A serve naplója külön sorral rögzíti a megszakítást (`[serve] Munka megszakítva: <jobId>`).

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
7. `ready` és `failed` visszahívás `cancelled` soron nem ír állapotot és nem küld üzenetet; `cancelled` visszahívás `noteUrl`-lel egyszer küld üzenetet, másodszor nem.
8. Más felhasználó jobjára a koppintás nem változtat semmit.
9. `/help` kötés nélkül is megy; a többi parancs kötés nélkül `BIND_FIRST`-et ad.
10. `/ping`, `/version`, `/status` működő és nem elérhető serve mellett; a `/status` a D1-ből számolja a nyitott munkákat.

**Serve**
1. `POST /jobs/<id>/cancel`: futó jobra `200` (ismételve is), más azonosítóra `404`, titok nélkül `401`; a kapu a futás leállása után szabadul.
2. `runRecipes` megszakítás után: a második egységre nincs modellhívás (hívásszámláló hamis klienssel), az első jegyzet commitolva van, az eredmény `cancelled` a `done` listával.
3. `commandRun` indulás előtt megszakítva: nulla modellhívás, `run:aborted` esemény `reason: "megszakítva"`.
4. `runJob` a feltöltés előtt megszakítva: nincs `store.put`, a `deletePair` lefut, a visszahívás `cancelled`.

**Kézi próba az élő környezetben:** a peter-mba-n kétreceptes futást indítani, kiadni a `/cancel`-t, és ellenőrizni: a serve naplója leállást mutat, a `/status` `busy` értéke visszaáll `null`-ra, és a vaultban csak a kész jegyzet van.

## 6. Kiadás

Minor verzióemelés és changelog PR-en át, tag, majd a konténerkép kiadása és a Worker telepítése a bevált menet szerint. **A sorrend számít:** előbb a serve (a peter-mba frissítése az új képpel), utána a Worker. Ha a Worker lenne előbb, az új Worker a régi serve-nek küldene cancel kérést; az `404`-et adna, a Worker `unknown`-nak venné, `cancelled`-re állítaná a jobot, miközben a serve futna tovább. A fordított sorrend ártalmatlan, mert a régi Worker nem küld cancel kérést.

A `docs/operations/telegram-worker-topology.md` kapja meg az új végpontot és a parancsokat.

## Nyitott pontok a tervhez

- A parancsok és a visszajelzések pontos szövegei (`/help`, "Megszakítva…", "Megszakítás kérve").
- A `commandRun` kilépési kódja megszakításkor: a `runRecipes` a megszakítást a `signal.aborted` alapján ismeri fel, nem a kódból, de a plan szintjén a hurok utáni ágat érdemes ellenőrizni.
- Hogyan bánik a mai `linesForMessage` az ismeretlen `/parancs`-csal: a terv ellenőrzi, és tesztben rögzíti.
- A #220 címének és törzsének frissítése a spec jóváhagyása után (a `/help`, `/ping`, `/version`, `/status` és a döntések belekerülnek).
