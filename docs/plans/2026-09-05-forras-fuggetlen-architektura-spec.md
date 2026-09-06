# Spec — Forrásfüggetlen bemenet

**Dátum:** 2026-09-05 · **Státusz:** jóváhagyásra vár

Ez a dokumentum a [`2026-09-05-forras-fuggetlen-architektura.md`](<./2026-09-05-forras-fuggetlen-architektura.md>)
terv specifikációja. A terv ebből érvel; a végrehajtó mindkettőt olvassa.

## A cél egy mondatban

Az app egyetlen bemeneti szerződése a **kész `.vtt`/`.srt` feliratfájl**. Hogy azt
a Pinchflat, a whisper, a yt-dlp vagy bármi más állította-e elő, az érdektelen — a
fogalom tűnjön el a kódból, a konfigurációból és a dokumentációból.

## Kiindulási állapot

Amit ez a változtatás felborít a mai kódban:

- `src/source/folder.ts`: a felderítés **`.info.json`-vezérelt** — az iterálás az
  info fájlokon megy, a felirat csak testvérfájlként kerül elő. Info.json nélküli
  felirat ma láthatatlan. Ez fordul meg.
- `src/config.ts`: `.env`-alapú; `VAULT_PATH` + `PINCHFLAT_DOWNLOADS` (egyetlen
  mappa), a jegyzet-gyökér beégetve: `Resources/Videos/YouTube`.
- `src/state/db.ts`: a `video_id` az elsődleges kulcs mind a három táblában
  (`videos`, `transcripts`, `artifacts`).
- `src/vault/paths.ts`: `<Csatorna>/<Cím>/` beágyazás, fájlnév
  `Youtube - <cím><utótag>.md`, kis-nagybetű-érzéketlen csatornamappa-keresés.
- `src/vault/render.ts`: frontmatter = `video_id`, `title`, `channel`, `uploaded`,
  `url` + a futás mérőszámai.
- `src/cli.ts:73` és `:128`: `folderSource(cfg.pinchflatDownloads)` — egyetlen
  forrás.
- `package.json:20`, a `sample:fetch`: egy `.env`-et source-oló shell-egysoros,
  ami rsync-kel másol egy távoli gépről. Ez megszűnik.
- `docs/roadmap.md`: a Fázis 2 (whisperes újratranszkribálás) és a Fázis 4
  (URL-adapter letöltéssel) sikerkritériumai feliratot **előállító** lépéseket
  írnak le — pontosan azt, amit az új szerződés kizár.

## 1. Konfiguráció — YAML, szigorúan

- Minden beállítás a `refinery.config.yaml`-ból jön (alapértelmezés: projekt
  gyökere), a `--config` kapcsoló írja felül az útvonalát.
- Egyetlen kivétel: a `LITELLM_API_KEY`, ez marad `.env` / környezet. Más értéket
  környezeti változó **nem** írhat felül — egy forrás, egy igazság.
- A validálás maradjon zod-alapú. A hibaüzenetben szerepeljen a YAML-mező útja és
  a betöltött fájl útvonala.
- A `.env.example` lecsökken a `LITELLM_API_KEY`-re; mellé készül kommentelt
  `refinery.config.example.yaml`. A README és a docs ehhez igazodik.
- A `loadConfig` / `loadModelConfig` szétválasztása **marad**: a `scan` és a `run`
  modell-kulcs nélkül is fusson le, a kulcsot csak a receptfuttatás kérje.
- A YAML-olvasáshoz új függőség: `yaml`.
- A `pnpm sample:fetch` script törlődik a `package.json`-ból, a
  `REFINERY_SAMPLE_SOURCE` és `REFINERY_SAMPLE_DEST` változókkal együtt. A korpusz
  behozatala nem az app dolga: helyette a README kap egy egysoros, másolható
  rsync-parancsot fejlesztői megjegyzésként. Ez dokumentáció, nem konfiguráció —
  se YAML-mező, se környezeti változó ne tartozzon hozzá.

Szerkezeti váz:

```yaml
vault:
  path: /abszolút/út/a/vaulthoz
  notes_dir: Inbox/transcript-refinery   # alapértelmezés, elhagyható
sources:
  - /abszolút/út/felirat-mappa-1
  - /abszolút/út/felirat-mappa-2
languages: [hu, en]
state:
  path: .state/refinery.db
model:
  base_url: http://localhost:4000/v1
  draft: claude-sonnet-5
  judge: grok-4-fast-reasoning
pricing:
  draft: { input_per_million: 3.00, output_per_million: 15.00 }
  judge: { input_per_million: 0.20, output_per_million: 0.50 }
cost_limit_usd: 5.00
```

## 2. Felderítés — felirat-vezérelt

- A `sources` minden eleme alatt rekurzívan **minden `.vtt` és `.srt` fájl**
  potenciális elem. Az `.info.json` opcionális kiegészítő, nem belépő.
- **Alapnév** = a feliratfájl neve az `.srt`/`.vtt` levágása, majd egy esetleges
  nyelvi utótag (`.en`, `.hu`, `.en-US`) levágása után.
- **Sidecar metaadat:** `<alapnév>.info.json` ugyanabban a mappában, ha létezik.
- Egy alapnévhez **egy elem** tartozik. Több feliratfájl esetén a `languages`
  lista sorrendje dönt. Ha egyik preferált nyelv sem található (vagy nincs nyelvi
  utótag), determinisztikus tartalék: `.srt` előbb, mint `.vtt`, azon belül
  ábécésorrend. A választás legyen futásfüggetlenül reprodukálható.
- A médiafájl-keresés (`.mp4`/`.mkv`/`.webm`) és a `SourceItem.mediaPath`
  megszűnik: az app médiát nem olvas.
- A sérült/olvashatatlan `info.json` ne állítsa meg a futást — az elem metaadat
  nélkül dolgozódik fel, ahogy ma a hibás JSON-t átugorja.

## 3. Azonosító

- Ha van `info.json` és benne használható `id`: **az** az elem azonosítója.
- Ha nincs: a `<forrásnév>/<forráson belüli relatív alapnév>` párosból képzett
  stabil hash.
- A state-séma ennek megfelelően `item_id` kulcsra vált mindhárom táblában, a
  `video_id` nullable metaadat-oszlopként marad.
- **Ismert következmény, amit dokumentálni kell, nem megkerülni:** ha egy elem
  mellé utólag kerül `info.json`, az elem új azonosítót kap és újra feldolgozódik.

## 4. Kimenet a vaultban

- A jegyzet-gyökér a `vault.notes_dir` a YAML-ból, a vaulton belüli relatív útként
  értve. Ha a mező hiányzik, az alapértelmezés `Inbox/transcript-refinery`. Az
  alapértelmezés **egy helyen, konstansként** éljen.
- Ezen belül: `<notes_dir>/<forrásnév>/` — a forrásnév a `sources`-beli útvonal
  basename-je. A hiányzó mappákat hozza létre.
- Azon belül a forrásmappa relatív szerkezete tükröződik, a fájlnév a felirat
  alapneve + a recept utótagja:
  `<notes_dir>/<forrás>/<relatív út>/<alapnév>_transcript.md`
- A `Youtube - ` prefix és a `<Csatorna>/<Cím>/` beágyazás megszűnik, a
  `resolveChannelDir` metaadat-alapú mappakeresésével együtt. **A célút nem
  függhet metaadattól:** `info.json` nélkül is ugyanoda kell írnia.
- A publikálás write-once marad (létező fájlt csak `--force` ír felül), a
  `--dry-run` és a vault git-műveletei változatlanok.

## 5. Frontmatter — mindig készül

- Minden jegyzet **érvényes YAML-frontmatterrel** készül, `info.json` nélkül is. A
  metaadat hiánya mezőket vesz el, a frontmattert magát nem.
- Mindig jelen lévő mezők: `item_id`, `title`, `source`, `source_file`,
  `transcript_source`, `words_raw`, `words_normalized`, `punctuation_density`,
  `generated_at`, `generator` — ahol a `title` `info.json` híján a felirat
  alapneve, a `source` a forrás basename-je, a `source_file` a forráson belüli
  relatív útvonal.
- `info.json` meglétekor ezek jönnek hozzá: `video_id`, `channel`, `uploaded`,
  `url`, `duration`, `tags`, `description`.
- Receptfuttatáskor ezek jönnek hozzá: `recipe`, `model`, `iterations`, `score`,
  `cost_usd`.
- A hiányzó mezők maradjanak **ki** a frontmatterből, ne kerüljenek bele `null`
  értékkel.
- A `description` többsoros lehet: YAML-biztos idézés vagy blokk-skalár kell, a
  mostani `yamlScalar` ezt nem tudja.

## 6. Dokumentáció és takarítás

- A `PINCHFLAT_DOWNLOADS`, a `Resources/Videos/YouTube` beégetett út és minden
  szolgáltatóspecifikus elnevezés eltűnik a `src/` és `docs/` alól.
- A `docs/decisions/` ADR-eket és a `docs/plans/` terveket **ne** írd át: azok
  történeti feljegyzések, a bennük szereplő `sample:fetch`- és
  Pinchflat-említések maradnak. Új ADR készül (0008), amely felülírja a
  `0003-ingest-sorrend`-et és rendezi a `0005-transzkribalasi-ut` viszonyát az új
  bemeneti szerződéshez.
- A `docs/architecture.md` és a `README.md` ehhez igazodik.
- A `docs/roadmap.md` is frissül:
  - Fázis 0 és 1 sikerkritériumaiból kikerül a metaadat-függés (a „csatornával,
    címmel" listázás `info.json` nélkül nem teljesíthető), és a helyükre az új
    kimeneti út és a mindig meglévő frontmatter kerül.
  - Fázis 2 és Fázis 4 közvetlenül ütközik az új szerződéssel, mert feliratot
    **előállító** lépéseket ír le. Ezt a terv nevezze meg és javasoljon rá
    döntést — kivezetés, külön eszközzé választás, vagy átfogalmazás úgy, hogy a
    feliratot előállító lépés kívül van az appon. A terv ne döntse el magától, és
    ne is hallgassa el.
  - A megmaradó fázisok sikerkritériumai továbbra is megfigyelhető viselkedést
    írjanak le, ne fájltartalmat.

## Megkötések

- **Tiszta törés:** a `.state/refinery.db` eldobható és újraépül, migrációs kód
  nem készül. A `Resources/Videos/YouTube` alatti régi jegyzetek érintetlenül
  maradnak, átmozgatás nincs.
- **TDD:** minden viselkedésváltozás előbb bukó tesztben jelenjen meg. Az érintett
  meglévő tesztek (config, source/folder, cli, vault/paths, vault/render,
  state/db, e2e) átírandók, nem törlendők.
- A meglévő normalizálási, recept-, rubrika- és költségréteg viselkedése **nem
  változik** — ez architektúra-átírás, nem funkcióbővítés.
- Az `evals/` továbbra is fusson.

## Sikerkritériumok

Megfigyelhető viselkedés, nem fájltartalom. Mindegyikhez tartozzon teszt:

1. Egy mappa, benne csak `foo.en.vtt` (`info.json` nélkül) → a `scan` 1 elemet
   talál, a `run` jegyzetet ír, és a jegyzetnek van érvényes frontmattere
   `item_id`, `title`, `source`, `source_file` és a mérőszámok mezőkkel;
   `video_id`, `channel`, `url` nem szerepel benne, üresen sem.
2. Ugyanez `foo.info.json`-nal → 1 elem, a frontmatter az 1. pont mezőin túl
   `video_id`, `channel`, `uploaded`, `url`, `duration`, `tags`, `description`
   mezőket is tartalmaz.
3. `foo.hu.vtt` + `foo.en.srt`, `languages: [hu, en]` → 1 elem, a magyar
   feliratból; a futás kétszer lefuttatva ugyanazt választja.
4. Két `sources`-elem → két külön almappa a vaultban, mindkettő a saját
   basename-jével; a nem létező mappák létrejönnek.
5. `vault.notes_dir` nélküli YAML → a jegyzet az `Inbox/transcript-refinery` alá
   kerül; a mezőt kitöltve ugyanaz a futás a megadott mappába ír, és az
   `Inbox/transcript-refinery` nem jön létre.
6. Hiányzó `refinery.config.yaml` → a hibaüzenet megnevezi a keresett útvonalat és
   a `--config` kapcsolót.
7. Hiányzó `LITELLM_API_KEY` mellett a `scan` és a `run` lefut, csak a
   receptfuttatás hibázik érthető üzenettel.
8. `pnpm run` kimenetében nincs `sample:fetch`, és
   `grep -rn "REFINERY_SAMPLE\|sample:fetch" src/ package.json .env.example README.md docs/architecture.md docs/roadmap.md`
   nem ad találatot.
9. `grep -ri "pinchflat" src/ docs/architecture.md docs/roadmap.md README.md` nem
   ad találatot (a `docs/decisions/` és `docs/plans/` történeti anyagai
   kivételek).
10. `pnpm test` és `pnpm lint` zölden fut.
