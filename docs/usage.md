# Futtatási útmutató és CLI referencia

Ez a dokumentum a Transcript Refinery futtatási módjait, a parancssori (CLI) eszközöket, azok kapcsolóit, valamint a Nuxt-alapú webes felületet részletezi.

---

## 1. CLI parancsok

A fordítás (`pnpm build`) után a CLI háromféleképpen hívható, egyenértékűen
— a lenti példák `node dist/cli.js`-t használják, de `pnpm exec refinery` és
`npx refinery` ugyanígy működik (fejlesztés közben közvetlenül:
`npx tsx src/cli.ts`):

```bash
node dist/cli.js scan --queue
pnpm exec refinery scan --queue
npx refinery scan --queue
```

Az utóbbi kettő a `package.json` `bin` mezőjét használja. A csomag
`devDependencies`-ei közt saját magát is felveszi, `workspace:*` verzióval —
enélkül a pnpm egy workspace-gyökér csomag saját bin-jét nem kötné be a
`node_modules/.bin`-be. Az `npx` ugyanezt a helyi `node_modules/.bin/refinery`-t
találja meg; a registryhez nem is fordul, mert a csomag `"private": true`.

### Használat a terminálból, bárhonnan

A `refinery` parancs a gépen bárhonnan futtatható, ha egyszer globálisan
bekötöd (a repó gyökeréből):

```bash
pnpm build && npm link
```

A pnpm 12-ben a `pnpm link --global` már nem létezik, a `pnpm add -g link:.`
pedig bin nélkül köti be a csomagot — ezért itt az `npm link` a működő út.
A link a `dist/`-re mutat: kódváltozás után elég újra `pnpm build`. A
parancs alapból a **munkakönyvtár** `refinery.config.yaml`-ját keresi, ezért
más mappából a `--config` kell — a legkényelmesebb egy alias a shell
konfigurációjában:

```bash
alias refinery='refinery --config /abszolút/út/transcript-refinery/refinery.config.yaml'
```

A configban megadott relatív útvonalak (`state.path`, `logs.dir`) és a
`.env` a **config fájl mappájához** képest értendők, nem a munkakönyvtárhoz:
bárhonnan indítva ugyanazt az állapottárat és kulcsot használja.

---

## 2. Felderítés (`scan`)

Kilistázza a konfigurált forrásokból elérhető feliratokat, azok szószámát és becsült minőségét (fájlírás nélkül):

```bash
node dist/cli.js scan
```

A felderített videók összefésülése a vault feldolgozási sorába (`_queue.md`):

```bash
node dist/cli.js scan --queue
```

### Szöveges átirat (`--dir`, `--match`, `--file`)

Időbélyeg nélküli `.txt` vagy `.md` átiratból is készül jegyzet. Ezek csak
ezekkel a kapcsolókkal jönnek be; a konfigurált `sources` továbbra is csak
feliratot (`.srt`, `.vtt`) vesz fel. A kapcsoló erre az egy futásra a
`sources` helyére lép, a `scan` és a `run` ugyanúgy érti:

```bash
# előnézet: egy mappa .md fájljai, az almappákból is
refinery scan --dir ~/atiratok --match '*.md'
# csak egy almappa
refinery scan --dir ~/atiratok --match 'eloadasok/*.md'
# egyetlen fájl feldolgozása recepttel
refinery run --file ~/atiratok/átirat.txt --recipe summary
# a sorba vétel, majd a kipipált párok feldolgozása
refinery scan --dir ~/atiratok --queue
refinery run --queue
```

- A mintát mindig idézőjelbe tedd: a zsh az idézetlen `*.md`-t maga bontja ki,
  és találat nélkül el sem indítja a parancsot. A `/` nélküli minta a
  fájlnévre illik, a `/`-t tartalmazó a mappához képesti útra.
  A `--dir` a rejtett (`.`-tal kezdődő) fájlokat és mappákat, valamint a
  `node_modules`-t nem járja be.
- A cím és a jegyzet neve a fájlnévből jön; a nyelvkód a fájlnévből
  (`átirat.en.md`), hiányában a tartalomból.
- Az `.md` vezető frontmattere lekerül; a wikilinkből a felirata marad, a
  linkek célja csúcsos zárójelbe kerül, a link címe (`"cím"`) elmarad (a vault
  írási szabálya).
- Az azonosság a tartalomé: átnevezett vagy áthelyezett fájlért nem fizetsz
  újra, a szerkesztett fájl új tétel. Ha a jegyzet neve már foglalt, a
  write-once miatt kimarad (a `scan` jelzi); újrafeldolgozás `--force`-szal.
- Legfeljebb 2 MB, UTF-8 szöveg. A sorban a tétel horgonya rejtve az
  útvonalat is viszi; ha a fájl közben eltűnik vagy megváltozik, a
  `run --queue` „nem található”-nak jelöli.
- Nem használható együtt: `--dir` és `--file`; `--source` ezek mellett;
  `--match` `--dir` nélkül.

---

## 3. Feldolgozás (`run`)

A jegyzetek elemenként egy mappába kerülnek: `<jegyzetgyökér>/<forrás>/<sablon>/<alapnév><utótag>`.
A sablon a `vault.layout` (alapértelmezés: `{channel}/{item_id}`; ismert mezők: `item_id`,
`title`, `channel`, `video_id`, `uploaded`), a hiányzó mező szegmense kimarad. Az elem mappája
az első kimenetnél rögzül: a további receptek ugyanoda kerülnek, akkor is, ha a sablon közben
változott. A vaulton belül átmozgatott jegyzetet a `run` és a `watch` az `item_id` alapján
követi (a `scan` csak jelzi).

### Módok

- **Csak átirat készítése (modellhívás nélkül, ingyenes):**  
  Normalizálja, deduplikálja a feliratot és beírja a vaultba:
  ```bash
  node dist/cli.js run
  ```

- **Recept futtatása LLM-mel (összefoglaló, tanulókártyák, kérdés-felelet):**
  ```bash
  node dist/cli.js run --recipe summary
  node dist/cli.js run --recipe flashcards
  node dist/cli.js run --recipe qa
  ```

  Több recept egy futásban: `run --recipe qa --recipe flashcards`. Egy közös
  költségplafon alatt fut, a `--limit` az elemeket számolja, nem a recepteket.
  A `--queue` és a `--retry-failed` mellett csak egy `--recipe` adható meg.

- **Feldolgozási sor (`_queue.md`) alapján:**  
  A vault jegyzetében kipipált `[x]` (videó, recept) párok feldolgozása:
  ```bash
  node dist/cli.js run --queue
  ```

### Gyakori kapcsolók

- `--dry-run`: nem ír fájlt és állapotot (de a modellhívás valós költséggel lefut)
- `--limit <szám>`: legfeljebb ennyi elem feldolgozása (pozitív egész)
- `--source <név>`: szűrés adott forrásmappára
- `--channel <név>`: szűrés csatornanévre
- `--retry-failed`: csak a korábban hibára futott elemek újrafuttatása
- `--force`: a már elkészült jegyzetek felülírása. `--queue` mellett a sor
  **minden** kipipált párját újrafuttatja, a `scan` által késznek jelölteket
  (és a kézzel odatett jegyzeteket) is, valódi költséggel; a `--recipe`,
  `--source`, `--channel` és `--limit` szűkíti
- `--no-commit`: nem commitol és nem pushol automatikusan a vault Git repójába
- `--no-judge`: a bíró pontozói nem futnak (a determinisztikus kapuk igen);
  felülírja a `model.judge_enabled` beállítást. Ha alapból bíró nélkül
  futnál, a configban állítsd `model.judge_enabled: false`-ra (alapértéke
  `true`). Visszafelé nincs kapcsoló: `false` mellett egy futásra
  parancssorból nem kapcsolható vissza a bíró, ahhoz a configot kell
  átírni
- A recept időkorlátja és az életjel a `model:` blokkban állítható:
  `recipe_timeout_minutes` (alapból 25) és `heartbeat_minutes` (alapból 10),
  percben, törtszám is lehet. Egy recept a korlát után újrapróbálkozás nélkül
  leáll; amíg fut, az életjel ennyi percenként ír egy sort (és a Telegramra
  üzenetet)

### A futás nyoma

Minden futás egy JSONL naplót és egy azonos nevű Markdown
riportot hagy a `logs.dir` alatt, hogy a kettő párban maradjon.

A két időformátum szándékosan eltér. A **fájlnév és a futásazonosító UTC**
(`2026-09-07T02-14-03`): így a mappa listázása időrendbe rendez, és a nyomok
zónától függetlenül összevethetők. A **riport fejléce viszont helyi idő**
(`# Futás — 2026-09-07 04:14 → …`), mert azt ember olvassa: az UTC-bélyeg a
fali órához képest eltolva jelent meg, és a futás utólagos azonosítását
nehezítette.

---

## 4. Katalógus (`list`)

Terminálos áttekintés a felderített elemekről, típusonkénti állapottal —
csak olvas, modellt nem hív, `LITELLM_API_KEY` nélkül is fut. A jelek:
`✓` kész, `↓` kész, de a recept küszöbe alatt, `✗` hibás, `·` hátra.

```bash
# egy csatorna videói, típusonként egy oszloppal
node dist/cli.js list --channel "Sajjaad Khader"

# csatornánként: videószám, típusonként kész/összes, összköltség
node dist/cli.js list --channels

# amin a clean-moderate még nem futott — ezeket érdemes kipipálni a sorban
node dist/cli.js list --recipe clean-moderate --status pending
```

A `--status` (`done`, `failed`, `pending`) `--recipe` nélkül bármely típusra
illik: a `list --status failed` minden elemet mutat, amin legalább egy
típus hibára futott. A `--source`, a `--channel` és a `--limit` ugyanúgy
szűr, mint a `run`-nál. A `--channels` összesítő a teljes szűrt halmazt
számolja, ezért mellette a `--limit` nem hat, és ezt a parancs a hibakimeneten
jelzi. A számok ugyanabból az olvasó rétegből jönnek, mint a webes felületéi.

A cím a terminál szélességéhez igazodik (csonkolva), de legalább 20 karakter
széles: ennél keskenyebb terminálon a sorok a terminálban tördelődnek.

---

## 5. Figyelés (`watch`)

Előtérben futó figyelő: amint a letöltő új `.srt` vagy `.vtt` feliratot tesz a
configban megadott `sources` mappák valamelyikébe, abból átirat lesz, és az
elem bekerül a vault `_queue.md` sorába. **Modellt nem
hív, tehát nem költ** — a recepteket továbbra is te pipálod ki a sorban, és a
`run --queue` futtatja őket.

```bash
refinery watch                 # minden forrásmappa
refinery watch --source youtube
refinery watch --no-commit     # a vaultba ír, de nem commitol
```

Más kapcsolót (pl. `--dry-run`, `--recipe`) nem ismer: ilyenkor hibával,
indulás nélkül kilép.

Indításkor egy felzárkózó kör pótolja, ami a leállás alatt érkezett. Minden
eseményről egy sor megy ki:

```
14:32:05  új átirat: AI Engineer / Full Walkthrough … (en)
14:32:06  _queue.md frissítve: +1 elem
14:32:07  commit: a1b2c3d (push ok)
```

A letöltés közbeni fájlt megvárja (a fájl mérete ~2 mp-ig nem változik), és a
gyorsan egymás után érkező feliratokat egy körben dolgozza fel. Egy hibás
felirat nem állítja le: a hibát kiírja, és csak akkor próbálja újra, ha a fájl
megváltozik, vagy a watch újraindításakor. Ctrl+C-re a futó kör befejeződik;
a második Ctrl+C azonnal kilép.

---

## 6. Árazás ellenőrzése (`check-pricing`)

Összeveti a konfigurációban beállított árakat a LiteLLM élő díjszabásával,
**modellenként**: a `model.draft`, a `model.judge` és a `model.recipes`
minden modelljét egyszer.

```bash
node dist/cli.js check-pricing
```

A `--fix` a talált eltéréseket vissza is írja a konfigurációba, a fájl
megjegyzéseinek megtartásával:

```bash
node dist/cli.js check-pricing --fix
```

### Receptenkénti modell (`model.recipes`)

Alapból minden recept a `model.draft` modellen generál. Egy-egy recept más
modellre tehető:

```yaml
model:
  draft: sub2api--claude-opus-5-5
  judge: sub2api--claude-sonnet-5
  recipes:
    notes: sub2api--claude-sonnet-5

pricing:
  sub2api--claude-opus-5-5: { input_per_million: 4, output_per_million: 20 }
  sub2api--claude-sonnet-5: { input_per_million: 3, output_per_million: 15 }
```

- A kulcs pontos receptazonosító; a fordítás külön kulcs (`notes-hu`), nem
  örököl a forrásrecepttől.
- A pontozás mindig a `model.judge`.
- A `pricing` modellnév szerint áll; minden használt modellnek kell ár, és a
  költség (becslés, plafon, riport) a ténylegesen használt modell árán
  számolódik.

Ha egy modell nem fogadja el a kényszerített tool-hívást (pl.
`claude-opus-5-5` a LiteLLM-en át), a sémás receptek és a bíró magától
választható tool-hívásra váltanak; a futás ezt modellenként egyszer jelzi
(`! <modell>: a kényszerített tool_choice nem támogatott…`).

### Sémás kimenet mérése (`check-structured`)

A `model.switchable` minden modelljét kimeri: a három sémás recept (notes,
flashcards, bloom) sémájával próbálja, és összeveti a config `structured` /
`text` jelzésével. **Valódi modellhívás, valódi költséggel**: modellenként és
sémánként 3 próba. A becslést indulás előtt kiírja, és egyetlen hívás nélkül
megáll, ha a becslés kétszerese a `cost_limit_usd` fölött van. Végül kiírja a
sikeres hívásokból mért költséget (alsó becslés).

```bash
node dist/cli.js check-structured
```

Csak a `--config` kapcsolót ismeri; a többit (pl. a `--dry-run`-t) elutasítja,
hogy egy közös kapcsoló miatt ne fusson le csendben pénzbe kerülő mérés. A
configot nem írja át. 0 a kimeneti kód, ha minden modell mérhető volt és nincs
eltérés; 1, ha eltérés van, vagy egy modellről csak egyéb hiba (hálózat,
csonkolt válasz) jött, tehát nem mérhető.

---

## 7. Webes felület (Web UI)

A Nuxt-alapú, csak olvasási felület áttekintést ad a korpuszról és élőben közvetíti a futásokat:

```bash
# Fejlesztői mód:
pnpm web:dev

# Éles build és indítás:
pnpm web
```

A felület a `http://127.0.0.1:4310` címen érhető el.
Oldalai: áttekintő, elemek (szűrők URL-ből is: `/items?channel=<név>&kind=<típus>`),
riport, hibák, futások.

---

## 8. Kiküldés a showroomba (`deploy`)

A `refinery deploy` a vault jegyzeteit a [refinery-showroom](https://github.com/pcsontos/refinery-showroom)
tartalomszerződése szerinti `.mdx`-ként a showroom **helyi klónjába** írja
(`content/notes/<tétel>/<fajta>.<nyelv>.mdx` és `meta.json`), tételenként
commitol, a végén a `main` ágra pusholja. A push indítja a site deployját.

```bash
# egyszer: külön, csak a deploynak fenntartott klón (nem a site fejlesztői munkapéldánya)
git clone git@github.com:pcsontos/refinery-showroom.git ~/github/pcsontos/refinery-showroom-deploy
```

```yaml
# refinery.config.yaml
showroom:
  deploy: manual                     # auto | manual (alap: manual)
  clone_path: /abs/út/refinery-showroom-deploy
```

`showroom:` blokk nélkül a deploy ki van kapcsolva. A refinery nem klónoz, és
induláskor ellenőrzi, hogy a `clone_path` létező git-repó.

```bash
node dist/cli.js deploy
```

- **Mit visz ki:** az eredeti és a fordított jegyzeteket, valamint a szójegyzéket
  (`glossary.<nyelv>.mdx`). A nyers átirat nem megy ki. A `-orig` nyelvi végződés
  levágódik (`hu-orig` → `hu`), a hiányzó `origin` pótlódik.
- **Mit hagy ki, és miért:** a nem `hu`/`en` nyelvűt, a hiányos fordítás-mezőjűt
  (nincs `source_language`, vagy nincs `source_generated_at` és az eredeti sincs a
  vaultban), a `generated_at` nélkülit. A kihagyott fájlok neve okkal együtt
  kiíródik; ezek nem hibák. Az `mdx_failed` oldal is kihagyottként, okkal listázódik. **Szó nélkül** kimarad az a jegyzet, amelynek a
  mappájában nincs azonos alapnevű `<alapnév>_transcript.md`: a deploy (mint a
  `/notes` lista) a tételeket az átiratból indulva találja meg. Ilyenkor a
  jegyzetet az átirata mellé kell tenni, az átirat alapnevével.
- **Mikor ír újra:** ha nincs még meg a célfájl, vagy a `generated_at` más. A
  második futás változatlan vaultnál nem ír és nem commitol.
- **Csak hozzáad és frissít**, nem töröl.
- **Biztonság:** a klónnak a `main` ágon kell állnia, különben a deploy írás nélkül
  megáll. Írás előtt minden kimenet átmegy a site frontmatter-sémáján és
  -szabályain (kötelező mezők, a mezők típusa, a fordítás-hármas), az MDX
  fordításon és a `contract/mdx-components.json` komponenslistáján; ami nem felel
  meg, az nem kerül a commitba. A deploy ezeket a site kódjának átiratával nézi,
  ezért ha a site szabályai változnak, a deploynak is követnie kell őket.
- **LLM-es tagolás:** a `clean-*`, `summary` és `notes` oldalakat (nyelvi
  változatonként, a fordítást is) a modell webes olvasásra tagolja: bevezető
  `Röviden` / `In brief` blokk, címek, rövid bekezdések, kiemelés. Az eredeti
  szöveg egyetlen szava sem változhat: kódos ellenőrzés veti össze szóról szóra,
  és ami eltér, nem megy ki. A modell a `model.recipes.mdx` (hiányában a `draft`).
  A `flashcards`, `qa` és `bloom` oldalt kód bontja `<Accordions>`-ra, modell
  nélkül; a szójegyzék és az ismeretlen fajta csak escape-elve megy ki.
  `LITELLM_API_KEY` vagy modell-config nélkül a deploy egy sorban jelzi, és az
  LLM-es oldalakat a determinisztikus változattal írja.
- **`mdx_fallback: true`:** a jegyzet determinisztikus átalakítással készült (a
  törzs a kódon kívül escape-elve, komponens nélkül). A következő deploy, amelyik
  kap átalakítót, újra átalakítja. A kártya, a szójegyzék és az ismeretlen fajta
  végleges, ezeknél nincs fallback-jelző.
- **`mdx_failed: <generated_at>`:** az oldal átalakítása kétszer elbukott (vagy a
  modellhívás hibát dobott, vagy a kártyák nem bonthatók). A deploy nem próbálja
  újra, amíg a jegyzet `generated_at`-je ugyanaz; `refinery deploy --retry-failed`
  vagy a jegyzet változása után igen.
- **Költségplafon:** a deploy futásonként a `cost_limit_usd`-ig hív modellt; a
  folyamatban lévő oldal befejeződik (a plafont csak az oldal elején nézi, egy
  többdarabos `clean-deep` utána is végigmegy), a többi ebben a futásban fallback.
  A már kint lévő oldal akkor marad érintetlen, ha a jegyzet `generated_at`-je
  nem változott; ha közben újragenerálták, az új fallback íródik ki. Egyik sem
  kap `mdx_failed`-et. A jelentés kiírja az
  átalakítás tokenjeit, költségét és a kimaradt oldalak számát; a következő
  `refinery deploy` folytatja, így a teljes kör adagonként megy.
- **Félbemaradt futás:** a kiírt, de nem commitolt fájlokat a következő futás egy
  „maradék” commitba veszi, a pushra váró commitokat pedig elpusholja. A klónon
  `git pull --rebase` fut, így egy elbukott push után akkor is továbbmegy, ha a
  showroom `main`-je közben előrelépett (ezért kell a külön, csak a deployé klón).

### Szűrés, újragenerálás és szárazfutás

A kézi `deploy` szűkíthető, és előre megnézhető, mit tenne:

```bash
node dist/cli.js deploy --dry-run --item SlGRN8jh2RI
node dist/cli.js deploy --item SlGRN8jh2RI --kind summary --model <név>
node dist/cli.js deploy --channel "Csatorna A" --kind clean
```

- **`--item <id,…>`:** csak ezek a tételek. Vesszős lista és/vagy ismétlés
  (`--item a,b`, `--item a --item b`), az értékek uniója. Ismeretlen id hiba (kilépés
  1-gyel), a klón érintése és modellhívás előtt. Üres érték (`--item=`) is hiba, nem a
  teljes vault.
- **`--kind <fajta,…>`:** csak ezek az oldalfajták (`summary`, `notes`, `qa`,
  `flashcards`, `bloom`, `clean-mild`, `clean-moderate`, `clean-deep`, `glossary`);
  ugyanúgy vesszős/ismételhető. A rövid `clean` minden `clean-*` fajtára illik. A
  fordítás ugyanazt a fajtanevet kapja, ezért a `--kind summary` mindkét nyelvet viszi.
- **`--channel`, `--source`:** a `list` kapcsolóival azonos jelentés (pontos egyezés,
  kis- és nagybetű nélkül), de a vault-jegyzetek frontmatterének `channel` / `source`
  mezőjén, így a másik gép által feldolgozott tételek is kiválaszthatók. A szűrők
  kapcsolata ÉS.
- **Újragenerálás:** az `--item`-mel kiválasztott oldalak (`--kind` nélkül a tétel
  minden oldala, az `mdx_failed` is, `--retry-failed` nélkül) akkor is újra átmennek a
  modellen, ha a jegyzet nem változott. Ha az újragenerálás elbukik, a kint lévő oldal
  marad, és a jelentés kiírja az okot. A `--channel`, `--source`, `--kind` önmagában
  nem kényszerít újragenerálást.
- **`--model <név>`:** csak erre a futásra ez a modell tagol (a `model.recipes.mdx`
  helyett). A névnek a `pricing:` blokkban ismertnek kell lennie, különben hiba.
- **Függő munka:** a félbemaradt futás maradéka és a pusholatlan commitok szűrt
  futásban is kimennek; a jelentés külön sorban jelzi (`korábbi futás függő munkája
  is kimegy`).
- **`--dry-run`:** kiírja, mely oldalakat írná (`új`, `frissítés`, `újragenerálás`),
  melyik útvonalon (`LLM`, `kód`, `escape`), mit hagyna ki és miért (az `mdx_failed`
  oldalt is), és hány oldal változatlan. Nem ír, nem commitol, nem pushol, nem hív
  modellt; a klónon csak `git fetch` fut, és a távoli `main`-nel (rajta a helyi,
  pusholatlan állapottal) vet össze. **A költségplafont nem látja előre: az éles futás
  kevesebb oldalt írhat LLM-mel, mint a lista.**

### Automatikus kiküldés

`deploy: auto` mellett a `run` (a vault-push után) és a `serve` (a vault-push után,
a jelentés után: az LLM-es átalakítás percekig tarthat, a Telegram-válasz nem vár
rá, a site-link addig 404-et adhat) **csak az adott futás tételeit** küldi ki, nem a
teljes vaultot. Amíg a deploy fut, a `serve` kapuja foglalt: egy újabb
Telegram-kérés 409-et kap (a Worker sorban tartja és újrapróbálja), a `/status`
a már jelentett jobot még dolgozónak mutatja, és a `/cancel` a deployt nem állítja
le. `--no-commit` és `--dry-run` mellett, illetve sikertelen vault-commitnál
nem fut. A deploy hibája nem buktatja a futást: a CLI egy `deploy sikertelen:`
sort ír, a `serve` a naplóba (`[deploy]`), a jelentés ugyanúgy megy. A `watch`
nem kap `auto` bekötést (csak átiratot ír, az nem megy ki).

