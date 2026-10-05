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

---

## 3. Feldolgozás (`run`)

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

- **Feldolgozási sor (`_queue.md`) alapján:**  
  A vault jegyzetében kipipált `[x]` (videó, recept) párok feldolgozása:
  ```bash
  node dist/cli.js run --queue
  ```

### Gyakori kapcsolók

- `--dry-run`: nem ír fájlt és állapotot (de a modellhívás valós költséggel lefut)
- `--limit <szám>`: legfeljebb ennyi elem feldolgozása
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
szűr, mint a `run`-nál. A számok ugyanabból az olvasó rétegből jönnek, mint
a webes felületéi.

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
