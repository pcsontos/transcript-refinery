# Változásnapló

A projekt verziói a [szemantikus verziózást](https://semver.org/lang/hu/)
követik. Minden spec megvalósítása után új kiadás készül.

## [1.14.0] — 2026-10-09

A `/notes` oldal minden jegyzetet mutat, akkor is, ha a feldolgozást a
parancssorból indítottad, és a jegyzetek olvasásához már nem kell a GitHub.

### 📚 Minden jegyzet egy helyen

- **A `refinery run` jegyzetei is megjelennek:** Eddig a `/notes` csak a
  Telegramról indított feldolgozásokat listázta. Mostantól a vault összes
  jegyzete látszik, bárhonnan készült: a peter-mbp-ről, a peter-mba
  gazdagépéről vagy a konténerből. Ha ugyanarra a videóra több helyen is
  készült jegyzet, egy bejegyzés lesz, fajtánként a legfrissebb változattal
  (#180).
- **Látszik, honnan indult:** Minden bejegyzés mellett `telegram` vagy `cli`
  címke áll. A jegyzetek frontmatterében új `origin` mező rögzíti ugyanezt; a
  régi jegyzeteknél a `serve-out` mappa jelzi a Telegramot (#180).
- **A jegyzetet a `serve` adja:** A `serve` két új, `REFINERY_SERVE_SECRET`
  Bearer-tokenes végpontot kapott: a `GET /notes` a listát, a
  `GET /notes/<azonosító>/<fajta>` a jegyzet renderelt HTML-jét adja. A Worker
  innen olvas, a belépés továbbra is a Cloudflare Access (#180).
- **A régi linkek élnek:** A Telegramban már kiküldött
  `/notes/<szám>:<videóazonosító>/<fajta>` linkek ugyanazt a jegyzetet nyitják
  meg. Az új üzenetek `/notes/<videóazonosító>/<fajta>` linket küldenek (#180).
- **Jelzi, ha a peter-mba alszik:** Ha a gép nem érhető el, az oldal erről szól,
  és külön mondatot ad, ha a titkok nem egyeznek vagy a `serve` nem éri el a
  vaultot. Ha a vault frissítése nem sikerült, a lista tetején ott a
  figyelmeztetés (#180).

### 🔌 Nem függ a GitHubtól

- **Forge-független vault:** A jegyzet olvasása és a visszaadott hivatkozás nem
  használ GitHub-címet. A `serve` a vault-relatív útvonalat küldi vissza, így
  nem GitHub távoli címmel (például egy Forgejo-val) is működnek a
  Telegram-receptek. Eddig a nem GitHub vault minden receptet hibára futtatott
  (#180).
- **Kikerül a „Megnyitás a GitHubon” link,** és vele a GitHub-hívás (#180).

### 🛠 Gyorsabb és stabilabb olvasás

- **Gyors lista:** A `serve` csak a jegyzetek elejét (a frontmattert) olvassa be,
  és megjegyzi az eredményt, amíg a fájl nem változik. A valódi vaulton a második
  beolvasás ezredmásodpercekben mérhető (#180).
- **Egy rossz fájl nem buktatja a listát:** Az olvashatatlan vagy közben eltűnt
  fájl egyszerűen kimarad (#180).
- **Beragadt hálózatnál sem ragad be a git:** A lista előtti `git pull` legfeljebb
  10 másodpercig tart, lejáratkor a háttérfolyamatai is leállnak. A lista pullja
  és egy futás pullja nem ütközik: közben a `serve` új munkát nem fogad el, a
  Worker később újrapróbálja (#180).

### ⚙️ Üzemeltetés

- **Telepítési sorrend:** Előbb a konténerkép, utána a Worker, különben a
  `/notes` a két telepítés között hibát ad, és a közben készült Telegram-jegyzetek
  a régi Workeren 404-et.
- **Megszűnt Worker-változók:** A `VAULT_GITHUB_TOKEN`, a `VAULT_REPO` és a
  `VAULT_BRANCH` többé nem kell. A `wrangler secret delete` törli őket, a
  GitHub-token pedig visszavonható.

## [1.13.0] — 2026-10-09

A `serve` démon lekérdezhető lett, a CLI parancsonkénti súgót és verziókiírást
kapott, a bot szól, amikor egy recept ténylegesen elindul, a `/notes` oldalon
pedig egy videó egyszer szerepel.

### 🩺 A `serve` lekérdezhető

- **Él-e, melyik verzió fut:** A `serve` három új végpontot kapott. A
  `GET /ping` (`ok`) és a `GET /version` (`{"version": …}`) hitelesítés nélkül
  válaszol, a `GET /status` a `REFINERY_SERVE_SECRET` Bearer-tokenjével a
  verziót és az éppen futó munka azonosítóját adja (#177).
- **A `--config` végre számít:** A `refinery serve --config <út>` a megadott
  konfigurációt használja a feliratnyelvekhez és a receptfuttatásokhoz is. Ha a
  fájl nem tölthető be, a `serve` `Hibás konfiguráció: …` üzenettel, 1-es
  kóddal leáll, és el sem indul (#182).

### 🧭 CLI: súgó és verzió

- **Parancsonkénti súgó:** A `refinery help <parancs>` és a
  `refinery <parancs> --help` az adott parancs leírását, kapcsolóit és példáit
  adja. A `refinery help` a parancsok áttekintése. A `serve` súgója a
  környezeti változókat is felsorolja (#178).
- **Verzió:** A `refinery version` és a `refinery --version` kiírja a
  verziószámot, config betöltése nélkül (#177).

### 🤖 Telegram-bot

- **Szól, amikor elindul:** A „Sorba került” üzenet után egy második is jön,
  amint a feldolgozás ténylegesen elindul: „Elkezdődött a feldolgozás: …”.
  Foglalt konténernél akkor érkezik, amikor az újrapróbálás elfogadtatja a
  futást (#179).
- **Videónként egy bejegyzés a `/notes` oldalon:** Ha egy videóra több
  feldolgozás készült, már egyszer szerepel, a címe a YouTube-ra mutat, alatta
  a kész fajták rögzített sorrendben. Minden fajta a legfrissebb kész változatra
  linkel (#181).

## [1.12.1] — 2026-10-09

Javítások a Telegram-botban: a bukott recept üzenete megnevezi a receptet, és
az újrapróbált recept linkje biztosan megérkezik.

### 🐛 Javítások

- **A hibaüzenet megmondja, mi bukott:** Ha egy recept vagy fordítás hibára
  fut, a bot üzenete elöl megnevezi, például `qa: A futás megállt.` vagy
  `summary, notes → de: …`. Eddig csak a puszta hiba jött, így több
  párhuzamos futásnál nem derült ki, melyik bukott (#172).
- **Az újrapróbált recept linkje megérkezik:** Ha egy már kész recept később
  mégis hibát jelzett, az újrapróbálás után a kész link csendben elmaradhatott.
  Mostantól kimegy (#172).

### 📚 Dokumentáció

- A `docs/usage.md` kimondja, hogy a `refinery list --channels` összesítő
  mellett a `--limit` nem hat (#71).

## [1.12.0] — 2026-10-08

Megérkezett a Telegram-integráció negyedik szelete: a bot mostantól minden
receptet felkínál, nem csak a `summary`-t, és a kész jegyzeteket le is
fordíttathatod. Minden jegyzet megnyílik az olvasó oldalon.

### 🤖 Minden recept a botban

- **Kilenc gomb a felirat után:** A „felirat megvan” üzenet alatt a `summary`,
  `notes`, `qa`, `flashcards`, `bloom`, `clean-mild`, `clean-moderate`,
  `clean-deep` és `fordítás` gomb áll. Egy koppintás egy receptet futtat, a
  konténer meglévő `cost_limit_usd` plafonja alatt.
- **Jegyzetenként külön állapot:** Egy videóhoz több recept is futhat egymás
  után. A második koppintás ugyanarra a receptre „már sorban van” választ kap,
  a kész recept gombja a linket küldi újra, a bukott recept gombja újraindítja.
- **Kész üzenet linkkel:** `<cím> · <recept>. A jegyzet megvan.`, alatta az
  olvasó oldal hivatkozása.
- **A régi üzenetek gombja is működik:** A korábbi üzenetek `summary` gombja a
  `summary` receptet indítja.

### 🌍 Fordítás a botból

- **Választó a kész jegyzetekből:** A `fordítás` gomb a videó kész jegyzeteit
  kínálja kapcsolható gombként. A `tovább` után hét nyelvből (`en`, `hu`, `nl`,
  `de`, `es`, `fr`, `it`) választhatsz egyet.
- **Egy kérés, egy futás:** A kijelölt jegyzetek fordítása egy futásban, egy
  közös költségplafon alatt készül.
- **Érthető kihagyás:** Ha a videó már a kért nyelven szól, a bot a kihagyás
  okát írja meg (például `a forrás már magyar`), nem az általános hibát.

### 📖 Olvasó oldal

- **Minden kész fajta:** A `/notes` lista videónként az összes kész jegyzetet
  mutatja (például `notes · notes-de · transcript`), és mindegyik megnyílik a
  `/notes/<jobId>/<fajta>` címen.
- **A régi jegyzetek megmaradnak:** A korábbi `summary` jegyzetek linkje és
  listája ugyanúgy működik, mint eddig.

### 🔧 Javítás

- **A megfelelő napló hibaüzenete:** Ha ugyanarra a videóra egy másodpercen
  belül két futás indult, a konténer a korábbi futás naplójából olvashatta a
  hiba okát. Mostantól mindig a saját futásáét.

### ⚙️ Üzemeltetés

- **Új migráció:** A `0004_runs` létrehozza a `runs` táblát, és ebbe viszi át
  a korábbi `summary` jegyzeteket.
- **Új konténerkép kell:** A Worker és a konténer együtt változott. A régi
  Worker kérését az új konténer elutasítja, ezért a kettőt egymás után kell
  telepíteni, és közben ne koppints a botban. Ha mégis megtörtént, a Worker
  telepítése után futtasd le még egyszer:
  `UPDATE jobs SET status='ready', phase='subtitle' WHERE phase='summary'`.

## [1.11.0] — 2026-10-07

Megérkezett a Telegram-integráció harmadik szeletének második fele: a boton át
készült jegyzeteket mostantól egy belépéshez kötött oldalon olvashatod, a bot
linkje pedig erre az oldalra visz.

### 📖 Olvasó oldal a jegyzetekhez

- **Jegyzetlista a `/notes` címen:** A belépett Google-fiókod jegyzetei
  videónként, újak elöl, a cím és a dátum mellett `summary` és `transcript`
  hivatkozással. Ha még nincs jegyzeted, az oldal megmondja, mit tegyél.
- **Jegyzet megnyitása a `/notes/<jobId>/summary` és a
  `/notes/<jobId>/transcript` címen:** Az oldal a jegyzetet a vaultból olvassa,
  és a GitHub renderelt változatát mutatja, mellette „Megnyitás a GitHubon”
  hivatkozással. A `transcript` a summary mellett létrejövő tisztított átirat.
- **A bot linkje az olvasóra mutat:** A `summary` gomb után érkező üzenet
  második sora már az olvasó oldal hivatkozása, nem a nyers GitHub-cím. A gomb
  újabb megnyomása ugyanezt a linket küldi újra.
- **Belépés nélkül nem nyílik meg:** Az oldal Google-belépéshez (Cloudflare
  Access) kötött, és csak a saját jegyzeteidet mutatja. Más fiók jegyzete, a
  nem létező jegyzet és az ismeretlen fajta ugyanazt a `404` választ kapja.
- **Érthető hibák:** Ha a GitHub nem érhető el, a vault nem olvasható vagy a
  jegyzet hiányzik a vaultból, az oldal ezt egy mondatban megmondja.

### 🔒 Javítás

- **A bot csak privát chatben válaszol:** Csoportban a bot mostantól hallgat.
  Korábban egy csoportban kézzel beírt `/start <token>` a csoport többi sorát
  is a kötő fiókjához írhatta volna.

### ⚙️ Üzemeltetés

- **Új Worker-változók:** Az olvasóhoz kell a `VAULT_GITHUB_TOKEN` (csak olvasási
  jogú, a vault-repóra szűkített token), a `VAULT_REPO` (`<tulaj>/<repo>`) és a
  `VAULT_BRANCH`. Amíg nincsenek beállítva, a jegyzetek megnyitása `404`-et ad.
  A `wrangler secret put` viszi fel őket.
- **Cloudflare Access a `/notes` útvonalon is:** A meglévő, hosztnév-alapú
  Access-alkalmazáshoz a `notes` útvonalat is hozzá kell adni. Az egész Worker
  védelme nem kapcsolható be, mert a Telegram webhookját is elzárná.
- **Nincs migráció és nincs új konténerkép:** A változás csak a Workert érinti.

## [1.10.0] — 2026-10-07

Megérkezett a Telegram-integráció harmadik szeletének első fele: a bot
mostantól Google-belépéssel köti a Telegram-felhasználót egy fiókhoz, és csak a
kötött, engedélyezett e-mail címhez tartozó felhasználó parancsát fogadja el.

### 🔐 Google-kötés és e-mail alapú engedélyezés

- **Kötés a `/start` paranccsal:** A bot a `/start` után egy 10 percig érvényes,
  egyszer használható hivatkozást küld. A hivatkozás Google-belépésre visz
  (Cloudflare Access), majd vissza a Telegramba, ahol a bot visszaigazolja a
  kötést (`Bekötve: <e-mail>.`).
- **Biztonságos kötés két tokennel:** A bot üzenetében utazó hivatkozás és a
  belépés után készülő visszatérő token külön szerepet kap. Az idegen kérésére
  kiadott hivatkozás sem az idegent, sem a belépő tulajdonost nem köti be, és a
  már használt vagy lejárt hivatkozás hibaoldalt ad.
- **Az engedélyt az e-mail adja:** Parancsot az a Telegram-felhasználó küldhet,
  akinek van kötése, és a kötött e-mail szerepel a `TELEGRAM_ALLOWED_EMAILS`
  vesszős listán. Aki nincs bekötve, a `Előbb kösd össze a Google-fiókoddal:
  /start` üzenetet kapja, sor és kopogtatás nélkül.
- **Az e-mail törlése azonnal kizár:** Ha egy címet leveszel a listáról, a
  felhasználó a következő üzenetétől nem küldhet parancsot, a kötése megmarad.
- **Az összefoglaló gomb a saját sorokra szól:** A `summary` gomb csak azt a
  sort indítja, amely a koppintó fiókjához tartozik, és az üzenetek mindig a
  sor saját chatjére mennek.

### ⚙️ Üzemeltetés

- **Új Worker-változók:** A `TELEGRAM_OWNER_CHAT_ID` megszűnt a Workerből.
  Helyette kell a `TELEGRAM_ALLOWED_EMAILS` (vesszővel elválasztott e-mailek)
  és a `TELEGRAM_BOT_USERNAME` (a bot neve `@` nélkül).
- **Új D1 migráció:** A `0003_bindings.sql` a `jobs` táblához egy `sub`
  oszlopot, valamint a `bindings` és a `link_tokens` táblát adja. Telepítés
  előtt futtasd: `pnpm worker:migrate`.
- **Cloudflare Access a `/link` útvonalon:** A kötés oldalát a Cloudflare Access
  védi, Google-belépéssel. Csak a `/link` útvonalat szabad védeni, a Telegram
  webhookját nem.
- **Helyi hibakeresés kötéssel:** A `scripts/telegram-debug.sh` a saját
  Telegram-azonosítódat közvetlenül köti be a helyi D1-be (Access helyben nincs),
  a `scripts/worker-dev-vars.sh` pedig a hat új változót tölti le.

## [1.9.0] — 2026-10-06

Megérkezett a Telegram-integráció második szelete: a letöltött feliratokból
a Telegram gombról közvetlenül indítható az összefoglaló, amely bekerül az
Obsidian vaultba, a bot pedig elküldi a közvetlen GitHub-hivatkozást.

### 📝 Telegram summary és vault jegyzet

- **Summary gomb a kész feliratra:** A YouTube-cím feliratának letöltése után a
  kész Telegram-üzenet egy `summary` gombot kap (`summary:<jobId>`).
- **Állapotkövetés és fáziskezelés a D1-ben:** A Cloudflare D1 feladatok új
  `phase` (`subtitle` / `summary`), `note_url` és `note_notified` mezőkkel
  bővültek. A summary csak befejezett felirat fázisból indítható; a feltételes
  írás megelőzi a párhuzamos dupla indításokat.
- **Összefoglaló generálása R2-ből:** A `refinery serve` démon a `recipe: "summary"`
  kérésre a meglévő csővezetéket futtatja az R2-ből feloldott felirat és
  `.info.json` alapján, YouTube-hívás nélkül. Elkészíti a `_summary.md` jegyzetet
  (és szükség esetén a `_transcript.md`-t is).
- **Vault commit és push:** A serve futása után csak a frissen keletkezett
  jegyzetfájlok kerülnek a vault git commitjába, majd automatikus `git push`
  történik a vault távoli repójába.
- **Közvetlen GitHub-link:** A sikeres push után a serve összeállítja a GitHub blob
  URL-t (`https://github.com/<owner>/<repo>/blob/<branch>/...`), amit a Worker
  elküld a Telegram-chatbe.

### 🛠️ Feliratillesztés és dialektuskezelés

- **Kétirányú nyelvkód- és dialektusillesztés:** A letöltött feliratok nyelvkódjának
  párosítása (`matchLanguageTag`) mostantól kezeli a regionális címkéket
  (pl. `en-US` és `en`), megelőzve az eltérő jelölések miatti újraletöltéseket
  vagy téves hiányjelzést.
- **Dialektus-felmérés illesztése:** A felirat-felderítés a dialektuskódok
  esetén is megtalálja a bázisnyelvnek megfelelő feliratot.

### 🔍 Fejlesztői eszközök és hibakeresés

- **Telegram debug és vizsgálati eszközök:** Új segédprogramok a helyi
  hibakereséshez (`scripts/telegram-debug.sh`, `scripts/telegram-bot-info.sh`,
  `scripts/local-jobs.sh`, `scripts/worker-dev-vars.sh`).
- **VS Code hibakeresési profilok:** Frissített konfiguráció a `serve` és a Worker
  egyidejű futtatásához és ellenőrzéséhez.

## [1.8.0] — 2026-10-05

Megérkezett a Telegram bot és Cloudflare Worker integráció, az önálló
`refinery serve` démon közvetlen Cloudflare R2 felhőtárhellyel, valamint a
konténeres futtatás Dockerben.

### 🤖 Telegram bot és Cloudflare Worker

- A Telegramon megosztott YouTube-linkekből a Cloudflare Worker automatikusan
  feladatot hoz létre a Cloudflare D1 adatbázisban, majd továbbítja a
  `refinery serve` felé.
- Megbízható Telegram-válaszküldés: a Worker mindaddig megőrzi és újrapróbálja
  a válaszüzenetet, amíg a küldés sikeresen le nem zajlik.
- D1 migrációk és Worker fejlesztői parancsok (`worker:dev`, `worker:deploy`,
  `worker:migrate`, `worker:migrate:local`).

### 🌐 `refinery serve` démon és Cloudflare R2 feltöltés

- Új parancs: `refinery serve`, amely önálló HTTP szolgáltatásként futva
  fogadja a letöltési feladatokat a Workertől (`POST /jobs`).
- A letöltött `.vtt` feliratot és `.info.json` metaadatot aláírt kéréssel
  közvetlenül a Cloudflare R2 vödörbe menti, majd sikeres feltöltés után
  törli a helyi ideiglenes fájlokat.
- Fej nélküli (headless) működés: a `serve` és a `fetch` parancs config fájl
  (`refinery.config.yaml`) nélkül, tisztán környezeti változókból is üzemel.
- Valós idejű naplózás: részletes státuszjelzés a bejövő kérésekről, a
  `yt-dlp` letöltésről és az R2 feltöltésekről (`[serve]`).

### 🐳 Docker és üzemeltetés

- Hivatalos Dockerfile a `refinery serve` headless futtatásához, beépített
  `git` és `openssh-client` eszközökkel a konténerből történő vault-commitokhoz.
- `docker:build`, `docker:push` és `docker:publish` npm szkriptek a GitHub
  Container Registry-be (GHCR) történő publikáláshoz.
- Új üzemeltetési útmutató (`docs/operations.md`) a Telegram bot és a Worker
  architektúrájáról, környezeti változóiról és `curl`-ös teszteléséről.
- A CLI referencia a `README.md`-ből átkerült a részletes `docs/usage.md`
  dokumentumba.

### 🛠️ További fejlesztések és javítások

- **Feliratletöltés:** a `fetch` parancs mostantól kifejezetten a videó saját
  (szerzői) feliratát kéri el, megelőzve az automatikusan generált feliratot.
- **yt-dlp frissítés:** a Docker környezetben a `yt-dlp` a 2026.08.19-es
  verzióra frissült.
- **Helyi fejlesztés (DX):** VS Code hibakeresési profilok (`launch.json`) és
  Infisical támogatás a `serve` és a Worker helyi futtatásához.

## [1.7.0] — 2026-10-02

Az Opus 5.5 mostantól vázlatíróként és bíróként is használható, a generáló
modell receptenként választható, az árazás pedig modellnév szerint áll.

### 🤖 Opus 5.5 a sémás recepteken és a bírónál

- Az Opus 5.5 eddig 400-as hibával elutasította a sémás (strukturált) hívást,
  ezért a `flashcards`, `bloom` és `notes` recept, valamint a bíró pontozása
  elbukott rajta. Mostantól a refinery ilyenkor magától tool-hívásra vált, és
  a választ ugyanúgy a sémához ellenőrzi. Futásonként és modellenként egyszer
  szól erről: `! <modell>: a kényszerített tool_choice nem támogatott…`.
- Ha egy modell válasza nem felel meg a sémának, a futás `.jsonl`-naplója a
  hiba okát és a modell nyers válaszának elejét is rögzíti.

### 🎛️ Receptenkénti modell

- `model.recipes.<recept>`: a generáló modell receptenként felülbírálható,
  például `flashcards: sub2api--claude-sonnet-5`. A fordítás saját
  azonosítóval áll (`notes-hu`), nem örököl. A bíró modellje nem változik.
- A költségbecslés, a plafon és a riport a recepthez választott modell árával
  számol.

### 💲 Árazás modellnév szerint

- A `pricing` kulcsai mostantól a modellnevek, nem a `draft`/`judge` szerep.
  Minden használt modellnek kell ár; ha hiányzik, vagy egy `model.recipes`
  kulcs nem létező recept, a futás az induláskor beszédes hibával áll meg.
- A `check-pricing` modellenként ellenőriz, és a `--fix` a pontot vagy dupla
  kötőjelet tartalmazó modellnevet (`sub2api--grok-4.7`) is javítja.
- **Átállás:** a régi, szerep szerinti `pricing`-alakra a receptes `run` és a
  `check-pricing` átírási útmutatót ad. Írd át modellnév szerintire, utána a
  `refinery check-pricing --fix` az élő árakra állítja:

  ```yaml
  pricing:
    sub2api--grok-4.7: { input_per_million: …, output_per_million: … }
    sub2api--claude-opus-5-5: { input_per_million: …, output_per_million: … }
  ```

  A `judge_enabled` a `model:` alá tartozik. A `scan`, a `list` és a `fetch`
  régi configgal is fut.

## [1.6.0] — 2026-10-02

Új parancs: a YouTube-feliratok letöltése a refinery-ből indul, külön
eszköz nélkül.

### 📥 `refinery fetch subtitle`

- Egy YouTube-videóhoz, lejátszási listához vagy címlistához (`--list`,
  soronként egy cím) letölti a feliratot (`.vtt`, `.srt`) és az `.info.json`
  metaadatot. A célmappát a `run` és a `watch` forrásként be tudja olvasni.
  A letöltést a `yt-dlp` végzi, ezért annak a PATH-on kell lennie.
- Felismeri a szokásos YouTube-címeket: `watch`, `youtu.be`, `shorts`,
  `embed`, `playlist`, `music.youtube.com`, és a csupasz videóazonosítót. A
  `watch?v=…&list=…` cím alapból csak a videót jelenti, a teljes listát a
  `--yes-playlist` kapcsolóval.
- A célmappa alapból a config első forrása, a nyelvek a config `languages`
  listája. Mindkettő felülírható (`--out`, `--sub-lang`). A videó a
  csatornája mappájába kerül, a lista egy közös mappába; `--flat` esetén
  minden a célmappa gyökerébe.
- Újrafuttatva a már letöltött feliratot átugorja, a félbemaradt letöltést
  pótolja. Mindent újra a `--overwrite` tölt le. A `--playlist-items` a
  lista egy részére szűr.
- Tételenként `[OK]`, `[SKIP]` vagy `[FAIL]` sort ír, a végén összesítést.
  Hibás cím vagy felirat nélküli videó esetén a többi tétel lefut, de a
  kilépési kód 1. Ctrl+C-re a már kész tételek összesítésével áll le.
- A `run` és a `watch` továbbra sem használ hálózatot, csak a helyi fájlokat
  olvassa.

## [1.5.2] — 2026-10-02

Javítás: a feldolgozási sor zárójeles című videóknál sem akad el.

### 🐛 Javítások

- A `refinery scan --queue` eddig megállt, ha a sorban zárójeles című videó
  volt (például „… (My design workflow) …"). A kész jelölésnél téves hibát
  jelzett („a link célja nem szögletes zárójelben áll"), pedig a link
  szabályos volt. Mostantól az ilyen sorok is késznek jelölődnek. A
  `_queue.md` a hibás futásoknál sem sérült (#100).

## [1.5.1] — 2026-09-30

Javítás: a jegyzetek újra a valódi eszközverziót jelölik.

### 🐛 Javítások

- A jegyzetek frontmatterjében a `generator` mező eddig mindig
  `transcript-refinery@0.1.0` volt, bármelyik verzió írta. Mostantól a kiadott
  verziót mutatja (most `transcript-refinery@1.5.1`), és minden kiadással
  magától követi. A már kiírt jegyzetekben a régi érték marad.

## [1.5.0] — 2026-09-25

A `refinery` parancs mostantól bárhonnan biztonságosan fut, a tisztított leirat
három szerkesztési szinten készül, és az újonnan letöltött feliratok maguktól
bekerülnek a feldolgozási sorba.

### 🧭 Bárhonnan futtatható parancs

- A configban megadott relatív útvonalak (`state.path`, `logs.dir`) és a
  `.env` a **config fájl mappájához** képest értendők. Más mappából,
  `--config`-gal indítva a parancs ugyanazt az állapottárat látja, és nem hoz
  létre új, üres állapottárat, amely a kész elemeket újra kifizettetné.
- Globális telepítés: `pnpm build && npm link`, utána egy shell-aliasszal a
  terminálban bárhonnan hívható (lásd a README-t).

### ✂️ A tisztított leirat három szintje

- A `clean` helyett három recept: `clean-mild` (írásjel, nagybetű,
  félrehallás; nincs fejléc), `clean-moderate` (bekezdések és `##` fejlécek)
  és `clean-deep` (írott formára szerkeszt, ismétlések nélkül, időbélyeg
  nélkül). A töltelékszavakat mindhárom eltávolítja.
- A hűségkapu és a bíró szintenként mást vár; a küszöbök egy kalibráló
  mérésből jönnek (`docs/measurements/2026-09-25-clean-szintek-kalibralas.md`).
- Bármelyik szint fordítható (`translate.recipes: [clean-deep]` →
  `clean-deep-hu`).
- A `refinery list` oszlopkódja `cle-mil`, `cle-mod`, `cle-dee`; a
  riportoldal költséggrafikonján a három szint egy közös sorozat.
- **Átállás:** a régi `clean` azonosító megszűnt. A meglévő `_clean.md` és
  `_clean-hu.md` jegyzetek `clean-moderate` néven élnek tovább; a configban a
  `translate.recipes` `clean` elemét `clean-moderate`-re kell írni. Az első
  `scan --queue` minden meglévő videó alá felveszi a `clean-mild` és
  `clean-deep` sort is.

### 👀 Új feliratok figyelése

- Új `refinery watch` parancs: figyeli a forrásmappákat, és az új `.srt` vagy
  `.vtt` feliratból átiratot készít és felveszi a `_queue.md`-be. **Modellt
  nem hív, tehát nem költ** — a recepteket továbbra is te pipálod ki.
- Indításkor pótolja, ami a leállás alatt érkezett; a letöltés közbeni fájlt
  megvárja, a gyorsan érkező feliratokat egy körben dolgozza fel, és minden
  eseményről egy időbélyeges sort ír ki.
- Egy hibás felirat nem állítja le: a fájl változásakor vagy újraindításkor
  újrapróbálja. Ctrl+C-re a futó kör befejeződik; `--no-commit` mellett nem
  commitol a vaultba.

## [1.4.0] — 2026-09-25

Új **Riport** oldal a webes felületen (`/reports`): egy helyen látod, mennyit
költöttél, hová ment a pénz, mekkora a korpusz, és hol maradt gyenge egy
jegyzet. Csak olvas, futást nem indít.

### 📊 Hol megy a pénz

- **Összesítő sor:** a videók, a csatornák és a szavak száma, a futásnaplók
  szerinti tényleges költés és a vaultban lévő jegyzetek költsége — a kettő
  szándékosan különbözik, mert az újrafuttatások is pénzbe kerültek.
- **Költés futásonként:** oszlopgrafikon a tényleges és a becsült összeggel;
  rámutatva a parancs és az arány, kattintásra a futás oldala nyílik.
- **Költség csatornánként:** receptre bontott sáv, a fordítások egy közös
  színben, típusonként a tooltipben.
- Minden grafikon alatt ugyanazok a számok táblázatban is.

### 🗂️ Mit futtass legközelebb

- **Csatorna-katalógus:** csatornánként videószám, szószám, nyelv,
  feliratforrás, költség és receptenként a `kész/összes` arány.
- **Egy kattintásos parancs:** a hiányzó (csatorna, recept) párhoz a 📋 gomb
  a vágólapra teszi a `refinery run --recipe … --channel '…'` parancsot —
  elindítani a terminálból kell, indításkor a szokásos becsléssel.
- A katalógus cellája az elemlistára visz, csatornára és receptre szűrve; az
  elemlista szűrői mostantól az URL-ből is jöhetnek
  (`/items?channel=<név>&kind=<típus>`).

### ⭐ Minőség

- **Csatornánkénti minőség:** átlagpontszám, és hány jegyzet maradt a küszöb
  alatt — a leggyengébb csatorna felül.
- **Toplisták:** a legdrágább és a leghosszabb videók.

## [1.3.0] — 2026-09-24

Új `refinery list` parancs: SQLite-lekérdezés nélkül, a terminálban látod,
melyik videón mi készült el, csatornánként mennyi a lefedettség, és min nem
futott még egy recept. Csak olvas, modellt nem hív, `LITELLM_API_KEY` nélkül
is fut.

### 📋 Katalógus a terminálban

- **Elemlista:** videónként egy sor, típusonként egy jeloszloppal — `✓`
  kész, `↓` kész, de a recept küszöbe alatt, `✗` hibás, `·` hátra —, és az
  elem összköltségével.
- **Egy recept részletei:** `list --recipe clean` a jelek helyett az
  állapotot, a pontszámot és a költséget mutatja.
- **Csatorna-összesítő:** `list --channels` csatornánként a videók számát és
  típusonként a `kész/összes` arányt adja, a végén `Összesen` sorral.

### 🔎 Megtalálod, ami hiányzik

- `list --recipe clean --status pending`: amin a clean még nem futott —
  ezeket érdemes kipipálni a sorban.
- `list --status failed`: minden videó, amin legalább egy típus hibára
  futott.
- A `--source`, a `--channel` és a `--limit` ugyanúgy szűr, mint a
  `run`-nál; a csatornanév kis- és nagybetűtől függetlenül egyezik.
- A számok ugyanabból az olvasó rétegből jönnek, mint a webes felületéi,
  így a két nézet ugyanarra az állapotra ugyanazt mutatja.

## [1.2.0] — 2026-09-24

A feldolgozási sor (`_queue.md`) mostantól azt is mutatja, ami már kész: a
`scan --queue` bepipálja azokat a párokat, amelyeknek a jegyzete már a
vaultban van, és a futás nem fizet újra egy meglévő jegyzetért.

### ✅ Kész párok a sorban

- **Automatikus pipa:** a scan bepipálja a már kész (videó, recept) párokat,
  akkor is, ha a jegyzet a soron kívül, `run --recipe`-pel készült. Ha van
  róla futási eredmény, a pontszám, a költség és a link kerül a sorra; ha
  csak a jegyzetfájl van meg, `✓ már a vaultban` utótag.
- **Semmi nem vész el:** a meglévő `✓` utótagot a scan érintetlenül hagyja,
  pipát soha nem vesz le, és a saját sorokhoz továbbra sem nyúl.

### 💰 Nincs fizetés meglévő jegyzetért

- A futás a modellhívás **előtt** megnézi, létezik-e már a jegyzet. Ha
  igen, késznek veszi, és nem indít fizetős hívást — akkor sem, ha a
  jegyzetet kézzel tetted a vaultba.

### ⚠️ Figyelj a `--force`-ra

- `run --queue --force` a sor **minden** kipipált párját újrafuttatja,
  valódi költséggel — mostantól a scan által késznek jelölteket és a kézzel
  odatett jegyzeteket is. A `--recipe`, `--source`, `--channel` és
  `--limit` kapcsolóval szűkíthető.

## [1.1.0] — 2026-09-23

A feldolgozási sor (`_queue.md`) Obsidianban számozott, összecsukható
vázlat lett: csoport → videó → recept → fordítás. Az első `scan --queue`
a korábbi sort magától átalakítja, a pipák és az eredmények megmaradnak.

### 🗂️ Feldolgozási sor

- **Számozott vázlat:** forrásmappánként egy számozott `##` fejléc, alatta
  videónként egy számozott `###` fejléc, és receptenként egy pipa. A
  sorszámokat minden scan újraszámolja, így kézi törlés vagy átrendezés
  után is folytonosak.
- **A fordítás a forrása alatt:** behúzott nyelvi al-sorként áll a
  forrásreceptje alatt (`- [x] summary` alatt `  - [ ] hu`), és a szülővel
  együtt összecsukható. A bepipált fordítás továbbra is a `summary-hu`
  párt indítja; a pontszám, a költség és a link az al-sorra íródik vissza,
  a szülő recept sora érintetlen marad.
- **Célnyelvű videó alatt nincs fordítássor:** egy magyar videó alatt nincs
  `hu` pipa, amit feleslegesen ki lehetne pipálni. Ha ott már áll ilyen
  sor, a scan törli — a bepipáltat is —, és a konzolon kiírja, hányat. A
  vaultbeli jegyzetfájlhoz nem nyúl, csak a sorhoz.
- **Nyelvkód nélküli felirat:** ha a fájlnévben nincs nyelvkód, a scan a
  felirat szövegéből ismeri fel a nyelvet (modellhívás és költség nélkül).
  Ha a nyelv nem ismerhető fel biztosan, a fordítássorok megmaradnak.
- **Saját szakaszok védve:** a sor végére írt saját fejléc (például
  `## Jegyzetek`) a csoportok határa: alá a scan nem szúr be új videót vagy
  receptet, és a saját sorokat továbbra is bájtra érintetlenül hagyja.

### 🔄 Átállás a régi formátumról

- Az első `scan --queue` egyszer átalakítja a korábbi, lapos formátumú
  sort, a pipákkal, a pontszámokkal, a költségekkel és a linkekkel együtt.
  A második futás már nem változtat semmit.
- A `run --queue` régi formátumú sorra hibával megáll, és a
  `scan --queue`-t javasolja — nem dolgoz fel csendben nulla párt.

## [1.0.0] — 2026-09-23

Az első kiadás: a v1 architektúra (Fázis 0–6 és az üzemeltetési javítások)
teljes állapota. A korábbi munka kiadás nélkül, a `0.1.0` verzión futott;
ez a bejegyzés az egészet összefoglalja.

### ✨ Feldolgozás

- **Feliratból tiszta átirat, modell nélkül:** SRT és VTT beolvasás,
  ismétlődések kiszűrése, bekezdésekre tördelés és írásjel-sűrűségi
  minőségkapu, ami kiszűri a gépi feliratokat.
- **Forrásfüggetlen bemenet:** bármilyen mappából dolgozik, ahol `.srt` vagy
  `.vtt` fájl van; a metaadat (`.info.json`) opcionális, több forrásmappa is
  megadható.
- **Nyelvfelismerés:** ha a fájlnévben nincs nyelvkód, a felirat szövege
  dönt a nyelvről.
- **Köteges futás folytathatóan:** SQLite állapottár, a megszakított futás
  onnan folytatódik, ahol abbamaradt; a hibás elemek `--retry-failed`-del
  újrafuttathatók.

### 📝 Receptek

Hét jegyzettípus, mindegyik saját kiértékelő rubrikával:

- **`summary`** — összefoglaló.
- **`flashcards`** — tanulókártyák Decks-formátumban.
- **`qa`** — kérdés-felelet.
- **`clean`** — tisztított leirat bekezdésenkénti időbélyegekkel.
- **`bloom`** — Bloom-taxonómia szerint szintezett kártyák.
- **`notes`** — strukturált jegyzet.
- **Fordítás** — bármelyik recept kész jegyzetének célnyelvű változata
  (`clean-hu`, `summary-hu` …), a konfigban megadott receptekre.

### ✅ Minőségkapuk

- **Bíró és kapuk:** hűség- és lefedettség-bíró, determinisztikus
  formátumkapu, nyelvi kapu, szöveghűség-kapu a tisztított leirathoz,
  célnyelv- és vázkapu a fordításhoz.
- **A bíró kikapcsolható** (`--no-judge` vagy configból), ha csak gyors
  vázlat kell.
- **Csonka modellválasz** (kimeneti limit) hibával áll meg, nem kerül be
  félkész jegyzet.

### 💰 Költség

- **Előzetes becslés és plafon:** a futás előtt látszik a várható költség, a
  `cost_limit_usd` plafon elérésekor a köteg tisztán megáll.
- **`check-pricing`:** összeveti a configban megadott árakat a LiteLLM élő
  áraival; `--fix`-szel vissza is írja őket.

### 🗂️ Obsidian és felület

- **Jegyzetek a vaultba:** frontmatterrel, receptenkénti címkékkel,
  Obsidian-kompatibilis linkekkel; a publikált fájlok automatikus
  git-commitja a vaultban (`--no-commit`-tal kikapcsolható).
- **Feldolgozási sor (`_queue.md`):** a `scan --queue` felveszi a videókat,
  pipával választod ki, mi készüljön, a `run --queue` lefuttatja, és az
  eredményt (pontszám, költség, link) visszaírja a sorba.
- **Webes felület (Nuxt):** áttekintés, elemek, hibák és futások, élő
  követéssel.

### 📊 Napló és riport

- **Futásnapló** JSONL-ben és részletes konzolkimenettel.
- **Markdown riport** futásonként: korpusz-állapot, sor-állapot,
  figyelmeztetések, a fejlécben helyi idővel.
- **Súgó:** `--help` / `-h` a parancsok és kapcsolók listájával.

### 🐛 Javítások

- A megszakított futás elmaradt vault-commitja a következő futáskor pótlódik.
- A horgonyzás hibája bekezdésenként esik vissza, nem dobja el a teljes
  jegyzetet.
- A bíró tokenjei a bíró árán könyvelődnek.
- A CLI szimlinkelt `bin`-ből indítva is működik.
- A frontmatter címkéiben aláhúzás áll a szóköz helyett.

[1.14.0]: https://github.com/pcsontos/transcript-refinery/releases/tag/v1.14.0
[1.13.0]: https://github.com/pcsontos/transcript-refinery/releases/tag/v1.13.0
[1.12.1]: https://github.com/pcsontos/transcript-refinery/releases/tag/v1.12.1
[1.12.0]: https://github.com/pcsontos/transcript-refinery/releases/tag/v1.12.0
[1.11.0]: https://github.com/pcsontos/transcript-refinery/releases/tag/v1.11.0
[1.10.0]: https://github.com/pcsontos/transcript-refinery/releases/tag/v1.10.0
[1.9.0]: https://github.com/pcsontos/transcript-refinery/releases/tag/v1.9.0
[1.8.0]: https://github.com/pcsontos/transcript-refinery/releases/tag/v1.8.0
[1.7.0]: https://github.com/pcsontos/transcript-refinery/releases/tag/v1.7.0
[1.6.0]: https://github.com/pcsontos/transcript-refinery/releases/tag/v1.6.0
[1.5.2]: https://github.com/pcsontos/transcript-refinery/releases/tag/v1.5.2
[1.5.1]: https://github.com/pcsontos/transcript-refinery/releases/tag/v1.5.1
[1.5.0]: https://github.com/pcsontos/transcript-refinery/releases/tag/v1.5.0
[1.4.0]: https://github.com/pcsontos/transcript-refinery/releases/tag/v1.4.0
[1.3.0]: https://github.com/pcsontos/transcript-refinery/releases/tag/v1.3.0
[1.2.0]: https://github.com/pcsontos/transcript-refinery/releases/tag/v1.2.0
[1.1.0]: https://github.com/pcsontos/transcript-refinery/releases/tag/v1.1.0
[1.0.0]: https://github.com/pcsontos/transcript-refinery/releases/tag/v1.0.0
