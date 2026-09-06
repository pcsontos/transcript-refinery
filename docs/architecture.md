# Architektúra

Ez a dokumentum írja le, mit épít a Transcript Refinery, milyen darabokból áll, és
melyik darab miért ott van, ahol. A vitatott döntések külön indoklást kapnak a
[`decisions/`](<./decisions/>) mappában; a mérési stratégia a
[`evaluation.md`](<./evaluation.md>)-ben, a fázisok a [`roadmap.md`](<./roadmap.md>)-ben.

## 1. Mit csinál

YouTube-feliratokból strukturált tudásjegyzeteket állít elő egy privát Obsidian
vaultba. A feliratfájl rossz olvasmány: a YouTube gördülő ablakos formátumban
szolgálja ki, ahol minden sor háromszor szerepel, az automatikus feliratozás
írásjelek nélkül érkezik, és egy negyvenperces előadásból tizenegyezer szónyi
átirat lesz, amit senki nem olvas újra.

A rendszer ebből olvasható, kereshető jegyzetet csinál — és közben megméri, hogy
mennyire jól csinálja.

## 2. Alapelvek

Négy megkötés, ami minden későbbi döntést befolyásol:

**Az üzleti logika a magban lakik.** A mag egy könyvtár, aminek nincs tudomása a
felületeiről. Enélkül nincs headless batch, nincs unit teszt és nincs eval.

**A mag struktúrált eseményeket bocsát ki, nem szöveget ír ki.** A CLI ezt
progressznek rendereli, a Nuxt-felület SSE-nek, a naplózó pedig JSON sorokba
írja. Ha az eseményfolyam utólag kerülne be, a mag addigra tele lenne kiírással.

**Ami determinisztikusan megoldható, azt nem modell oldja meg.** A legnagyobb
hozamú lépés — a duplikált sorok kiejtése, ami a szöveg 66%-át leveszi — nem
igényel modellhívást. A formátumellenőrzés sem. A modell csak oda kerül, ahol
ítélet kell.

**Mérés nélkül nincs kimenet.** Egyetlen recept sem kerül be a rubrikája nélkül.

## 3. A rendszer alakja

```
                 ┌───────────────────────────────────┐
   forrás ──────►│              MAG                  │──────► vault
                 │  csővezeték + absztrakciók        │
                 │  struktúrált eseményfolyam ───────┼──┐
                 └───────────────────────────────────┘  │
                                                        │
                     ┌──────────────┬───────────────────┤
                     ▼              ▼                   ▼
                    CLI       Obsidian-queue         Nuxt-felület
                   (mag)      (jegyzet I/O)          (SSE, később)
```

A CLI az elsődleges kliens, és minden más ennek a testvére, nem a fölöttese. Az
Obsidian queue-jegyzet és a Nuxt-felület egyaránt a mag fogyasztója: sem
promptot, sem csővezeték-logikát nem tartalmaznak.

## 4. A csővezeték

Nyolc lépés, mindegyik önállóan tesztelhető:

| # | Lépés | Mit csinál |
|---|---|---|
| 1 | **Discover** | forrás-adapter felderíti a feldolgozandó elemeket |
| 2 | **Extract** | feliratfájl (SRT, VTT) → időbélyeges egységek |
| 3 | **Normalize** | egymás utáni ismétlődések kiejtése |
| 4 | **Classify** | felirat eredetének megállapítása írásjel-sűrűségből |
| 5 | **Refine** | receptenként: generálás → értékelés → javítás, korlátosan |
| 6 | **Render** | artefaktum → Markdown frontmatterrel |
| 7 | **Publish** | vault-írás ütközésvédelemmel |
| 8 | **Record** | állapottár frissítése |

Az 1–4. és a 6–8. lépés determinisztikus és offline. Modell csak az 5.
lépésben van — az újratranszkribálás nem lépése a csővezetéknek, lásd a
9. fejezetet.

### A normalizálás hozama

Az egymás utáni ismétlődések kiejtése a legnagyobb hozamú lépés, és teljesen
determinisztikus. Egy 153 videós valós korpuszon mérve:

| | összesen | átlag / videó |
|---|---|---|
| nyers | 1 754 644 szó | 11 468 |
| normalizálás után | **602 744 szó** | **3 939** |

A naiv, egymás utáni deduplikáció gyakorlatilag azonos eredményt ad, mint a teljes
egyedi-sor deduplikáció (602 744 vs 602 073 szó) — okos algoritmus nem kell.

Ennek van egy fontos architekturális következménye: **normalizálás után minden
átirat elfér egyetlen kontextusablakban** (medián 3 041 szó, p90 7 165, maximum
22 477). A darabolás és a map-reduce összefűzés, amit egy korábbi terv
feltételezett, teljes egészében kimarad — legfeljebb egy védőkorlát marad a
kiugró esetekre.

## 5. A három absztrakció

Három interfész, és több nem — a feliratot előállító lépés (letöltés,
transzkribálás) az appon kívül van
([`decisions/0008`](<./decisions/0008-forras-fuggetlen-bemenet.md>)):

- **`Source`** — honnan jönnek az elemek. Tetszőleges feliratmappa: a
  felderítés a feliratfájlokon iterál, a metaadat opcionális kiegészítő.
- **`Recipe`** — mi lesz egy elemből. Lásd a 8. fejezetet.
- **`Publisher`** — hova kerül a kimenet. Egy implementáció: a vault.

Nincs plugin-loader, nincs dependency injection konténer, nincs event bus. A
receptek statikus registryből jönnek: egy indexfájl importálja mindet. Néhány tucat
elemnél a dinamikus betöltés csak a fordítási idejű típusbiztonságot venné el.

## 6. Állapottár

**Hol:** a repó munkakönyvtárában, verziókövetésből kizárva, a
`refinery.config.yaml` `state.path` mezőjével felülbírálhatóan. Nem a vaultban — a vault tudást tárol, nem gépi állapotot, és két
checkout között szinkronizálva azonnal konfliktusforrás lenne.

**Mivel:** SQLite, a Node beépített `node:sqlite` moduljával — nulla függőség,
nincs natív fordítás. A pinnelt Node 26.2.0-n verifikálva: a `DatabaseSync`
kísérleti figyelmeztetés nélkül működik.

**Miért nem JSON:** egy több órás, több száz elemű futás alatt a teljes fájl
elemenkénti újraírása korrupciós kockázat. Épp arra a kérdésre kell válaszolnia,
hogy mi történik, ha a gép újraindul a batch közepén.

**Miért nem elég a kimeneti fájl léte:** az nem tudja megkülönböztetni, hogy egy
videónak azért nincs jegyzete, mert még nem próbáltuk, vagy mert **háromszor
elhasalt, és miért.** Egy hosszú futás hibariportja enélkül nem létezik.

Három tábla elég:

| tábla | mit tárol |
|---|---|
| `videos` | felderített elemek és metaadatuk |
| `transcripts` | a szöveg származása, modell, szószámok |
| `artifacts` | recept, státusz, útvonal, iterációszám, pontszám, költség, hiba |

A folytathatóság ebből ingyen adódik: ugyanannak a parancsnak az újrafuttatása
kihagyja a késznek jelölt elemeket. **Nincs külön `resume` parancs — a hétköznapi
parancs maga a resume.**

## 7. A vault-kimenet

### Hely

A kimenet a `vault.notes_dir` alatt, forrásonkénti almappában landol
(alapértelmezés: `Inbox/transcript-refinery/<forrás>/...`) — **nem** a vault
meglévő, kézzel gondozott jegyzet-elrendezésébe
([`decisions/0008`](<./decisions/0008-forras-fuggetlen-bemenet.md>)). A triage
nem hely kérdése, hanem lekérdezésé: az állapottár tudja, mi új.

Két szabály, mindkettő tesztelhető:

- **A célút nem függ metaadattól**: `<notes_dir>/<forrásnév>/<a felirat
  forráson belüli relatív mappája>/<alapnév><recept-utótag>`. Ugyanaz a
  felirat metaadatfájllal és nélküle is ugyanoda kerül — a write-once védelem
  így mindkét esetben ugyanazt a duplikátumot ismeri fel.
- A fájlrendszerre veszélyes karakterek normalizálása **idempotens**: kétszer
  lefuttatva ugyanaz jön ki.

### Ütközésvédelem

Írás csak akkor, ha a célfájl nem létezik. Felülírás kizárólag explicit
`--force`-szal. A vaultban évek kézi munkája van; a pipeline nem írhatja felül.

### Nyelv

**A jegyzet nyelve megegyezik a forrás nyelvével.** Ez nem stílusdöntés, hanem
mérési kényszer: a hűség-értékelés alapja a felirat, és ha a jegyzet más nyelven
van, a mérés kereszt-nyelvivé válik — pont abban lesz zaj, ami a projekt fő
bizonyítéka. Fordítás később, önálló receptként, nulla architekturális költséggel.

### Git

A vault git-repó, és két gépen van checkoutolva. A stratégia négy elemből áll, és
ezek együtt működnek:

1. **Futás előtt `git pull --ff-only`.**
2. **A publisher kizárólag a jegyzet-gyűjtemény alá ír** — szűk robbanási sugár.
3. **Sikeres futás után commit és push, kizárólag a ténylegesen írt útvonalakra.**
   Nem `git add -A`: így fizikailag képtelen felsöpörni félbehagyott kézi
   szerkesztéseket, a munkafa tiszta marad a következő pullhoz, és a divergencia
   ablaka percekre szűkül.
4. **Ha a push elhasal, nincs force és nincs újrapróbálkozás** — a commit lokálisan
   marad, a futás jelenti, a következő pull rendezi.

A 3. pont nem opcionális kényelem. Automata commit nélkül a munkafa piszkos marad,
és akkor a *következő* futás előtti pull bicsaklik meg: a „ne commitolj" és a
„húzz minden futás előtt" kizárják egymást.

### Frontmatter

Minden jegyzet rögzíti a származását — **metaadatfájl nélkül is**
([`decisions/0008`](<./decisions/0008-forras-fuggetlen-bemenet.md>)): az első
mezőcsoport mindig kitöltődik, a metaadatból jövő mezők (`video_id`,
`channel`, `uploaded`, `url`, `duration`, `tags`, `description`) hiány esetén
egyszerűen kimaradnak a frontmatterből — nem üresen szerepelnek:

```yaml
item_id: youtube-a1b2c3d4            # metaadat videóazonosítója, vagy forrás+alapnév hash-e
title: Egy előadás címe
source: youtube                       # a forrásmappa neve
source_file: Csatorna/Egy előadás címe.hu.srt
language: hu
video_id: dQw4w9WgXcQ                 # csak metaadattal
channel: Csatorna neve                # csak metaadattal
uploaded: 2026-07-14                  # csak metaadattal
transcript_source: creator_captions   # | auto_captions
words_raw: 11468
words_normalized: 3939
punctuation_density: 4.12
generated_at: 2026-08-30T09:14:22Z
generator: transcript-refinery@0.1.0
recipe: summary                       # csak recepttel futtatott jegyzeten
model: claude-sonnet-5
iterations: 1
score: 0.91
cost_usd: 0.0421
```

### Formátum-linter

A vault írási szabályai nem konvenciók, hanem **kikényszerített invariánsok**:
kötelező szögletes-zárójeles relatív link, tiltott wikilink, előírt link-emojik.
A renderer mellett fut egy linter, ami a generált Markdownt átengedi vagy
elutasítja. Ez unit teszt, nem remény.

## 8. Receptmotor

Egy dokumentumtípus egy modul:

```ts
export interface Recipe<T = string> {
  id: string                          // 'summary'
  outputFile: string                  // '_summary.md'
  publishable: boolean                // a blog-vázlat: false, véglegesen
  role: 'draft' | 'judge'             // modellszerep, nem modellnév
  prompt(input: RecipeInput): string
  schema?: ZodSchema<T>               // csak strukturált kimenetnél
  render?(value: T, ctx: Ctx): string // alapértelmezés: a szöveg maga
  rubric: Rubric
  maxIterations?: number              // alapértelmezés: 2
}
```

Erős alapértelmezések mellett egy prózarecept nagyjából tíz sor, amiből kilenc maga
a prompt. Séma és renderer csak a strukturált típusoknál kell.

A `publishable: false` nem konvenció, hanem a publisher által kikényszerített
invariáns. Bizonyos típusok — például egy cikkvázlat mások videójából — soha nem
kerülhetnek publikálási útra; ezt a rendszernek tudnia kell, nem az emberi
figyelemre bízva.

**Melyik recept fut:** futás-szintű kapcsoló. A szállított alapértelmezés
konzervatív. Hat recept létezhet a repóban anélkül, hogy hat lefutna.

### Az evaluator–optimizer loop

1. Generálás a recept promptjával.
2. A rubrika pontoz **és konkrét hiányokat nevez meg**.
3. Ha átment vagy elfogytak az iterációk → kész.
4. Különben újragenerálás a vázlat és a hiányok visszaadásával.
5. Minden revízió perzisztálódik.

Négy megkötés, mindegyik egy valós hibamódra:

- **Korlátos:** alapból legfeljebb két iteráció, tehát három generálás. A költség
  így felülről becsülhető — enélkül az előzetes költségbecslés nem volna érvényes.
- **A rubrika hiányokat ad vissza, nem csak pontszámot.** Egy szám nem tud javítást
  vezérelni. Épp ez az a pont, ahol a mérőeszköz és az optimalizáló jel *ugyanaz az
  objektum*.
- **Az értékelő a felirat ellen pontoz**, nem a vázlat önmagában vett meggyőző
  erejéhez képest. A viszonyítási alap végig az átirat.
- **Nem-javulási őr:** ha egy iteráció rosszabb az előzőnél, a jobbat tartjuk meg és
  megállunk. Enélkül a loop elkóborol — ez a minta tipikus csendes hibája.

Az értékelő szerep alapból **más modell**, mint a generáló. Ha ugyanaz a modell
pontozza a saját kimenetét, az önpreferencia-torzítás miatt a mérés kevesebbet ér.

### Amit a loop mellékesen megtermel

Minden iteráció pontszáma rögzül. Ebből egy olyan kérdés válik számmal
megválaszolhatóvá, amit a legtöbb hasonló projekt meg sem kérdez: **segít-e
egyáltalán a második iteráció, és mennyiért?**

A válasz lehet nemleges. Akkor az kerül a dokumentációba.

## 9. Transzkripció — kívül esik a hatókörön

Az automatikus feliratok újratranszkribálása nem az app rétege
([`decisions/0008`](<./decisions/0008-forras-fuggetlen-bemenet.md>)): ha egy
külső eszköz (pl. lokálisan futó `whisper.cpp`) újratranszkribál egy videót, a
kimenete egyszerűen egy újabb `sources`-bejegyzés — kódmódosítás nélkül megy
át a magon.

Az elemzés, hogy melyik transzkribálási út érné meg, ha ez az eszköz
megépülne, érvényes marad, csak nem ennek az appnak a része:
[`decisions/0005-transzkribalasi-ut.md`](<./decisions/0005-transzkribalasi-ut.md>).

### A minőségi kapu

Ami az appban marad: egyetlen küszöb, modellhívás nélkül, ami a feliratot
szerzőire vagy automatikusra osztályozza — **írásjel / 100 szó < 2,0 →
automatikus felirat.** A küszöb nem hangolt paraméter, hanem egy mért szakadék
közepe: a 153 fájlos korpuszon az 1,0 és 4,0 közötti teljes sávban egyetlen
fájl van. A kapu így megbízhatóan oszt — 47% automatikus, 53% szerzői felirat.

A határeset kézzel felcímkézve bekerül a mérési halmazba, mert pont az mutatja meg,
ha a kapu később elcsúszik.

> Egy korábbi elemzés a nagybetű-arányt is bevette a kapuba, és ezzel 40 fájlt
> önkényesen átsorolt. Az újabb ASR nagybetűsít, de nem tesz ki írásjelet — a
> nagybetű-arány itt használhatatlan diszkriminátor. Az írásjel-sűrűség egyedül a
> helyes kapu.

**A rendszer így az LLM-hívásokon kívül teljesen offline.**

## 10. Munkasor

A kötegelt viselkedés nem az URL-út tulajdonsága, hanem a munkasoré — forrástól
függetlenül. Már a v1 első futása is köteg: több mint másfélszáz elem a
letöltési mappából.

- **Konkurencia:** konfigurálható, alapértelmezés 2. Az LLM-lépés dominál, és a
  LiteLLM sebességkorlátja a valódi határ.
- **Részleges hiba: a futás mindig megy tovább.** Az elem hibája elemenként
  rögzül, a futás végén riport készül. Egy harmincelemű köteg nem veszíthet el
  tizenhat elemnyi munkát a tizenhetedik miatt.
- **Hibaosztályozás:** *átmeneti* (hálózat, sebességkorlát) → korlátos
  újrapróbálkozás exponenciális várakozással; *végleges* (nincs felirat, privát
  videó, értelmezési hiba) → rögzít és lép tovább.
- **Szűrők:** csatorna, darabszám, dátum — és elsődlegesen az állapottár, ami a
  már feldolgozott elemeket kihagyja.
- **A lista formátuma sima szöveg**: soronként egy URL, `#`-kommenttel. A per-sor
  felülbírálás (CSV, YAML) szándékosan kimarad: a receptválasztás futás-szintű, és
  a per-videó igény spekulatív. Cserébe a fájl kézzel is kellemesen bemásolható
  marad — ami a lényege, hiszen ez lesz az Obsidian queue-jegyzet is.

### Felderítés: nem figyelő, hanem szkennelés

Filesystem watcher nincs. Nemcsak megbízhatatlansága miatt: egy feliratot
előállító eszköz (letöltő, transzkribáló) fokozatosan írja a fájlokat, tehát a
watcher félkész feliratra és még hiányzó metaadatra tüzelne. Ezt
debounce-szal és stabilitás-ellenőrzéssel lehetne kezelni — valódi
bonyolultság nulla haszonért.

A v1 explicit szkennelő parancsot ad. Mivel a művelet idempotens, az ismételt
szkennelés ingyen van, tehát egy ütemezett futtatás később **konfigurációs
változás, nem architekturális.**

## 11. Költségkorlát

Két független réteg:

- **A LiteLLM a kemény kapu.** A projekt saját virtuális kulcsot kap saját havi
  kerettel, hogy egy elszaladt köteg ne vigye el más munkák keretét.
- **Az alkalmazás a lágy kapu.** Indulás előtt becslést ad, egy megadott plafon
  alatt el sem indul, és futás közben a modellválaszok használati adatai alapján
  megszakad, ha túllépné.

A becslés azért lehetséges, mert normalizálás után a szószám lokálisan,
modellhívás nélkül megszámolható. Így a „köteg nem indul felső korlát nélkül"
követelmény nem absztrakt szabály, hanem **konkrét szám a futás előtt.**

A modellek kiszolgálása egy meglévő **LiteLLM** gateway-en át történik. Az AI SDK
egyetlen `@ai-sdk/openai-compatible` providerrel csatlakozik a base URL-jére,
virtuális kulccsal. A LiteLLM telepítése és üzemeltetése **nem része ennek a
projektnek**: a rendszer adottnak veszi, hogy elérhető, és csak fogyasztja —
a base URL a `refinery.config.yaml`-ból, a kulcs kizárólag a környezetből
(`LITELLM_API_KEY`), induláskor validálva.

A receptek nem modellnevet kérnek, hanem **szerepet** (`draft`, `judge`), amit a
konfiguráció képez le konkrét modellre. A tényleges modellválasztás mérési
eredmény, nem vélemény: a mérőhalmazon több jelölt fut le, és a mért hűség és
lefedettség dönt, egységnyi költségre vetítve.

## 12. Üzemeltetés

### Konfiguráció

Minden beállítás a `refinery.config.yaml`-ból jön: a vault útvonala és
jegyzet-gyökere, a feliratforrások listája, a nyelvi preferencia, az
állapottár helye, a modell- és árbeállítás, a költségplafon. A fájl helyét a
`--config` kapcsoló írja felül; alapértelmezés a projekt gyökerében keresett
`refinery.config.yaml`.

Egyetlen érték nem innen jön: a `LITELLM_API_KEY`. Az titok, ezért kizárólag
a környezetből (`.env` vagy a tényleges környezet) érkezik — a YAML-ban nincs
helye. A `scan` és a receptet nem futtató `run` enélkül is elindul; a kulcs
csak akkor kötelező, ha `--recipe` fut.

### Futtatás

- **Ütemezett futtatás csak akkor, amikor van mit ütemezni.** A korai fázisok kézi
  parancsok. A szolgáltatásként futtatás akkor kerül be, amikor az ütemezett
  szkennelés valódi igény.
- **Indítás automatizálásból:** a futtatókörnyezetet a repó `.mise.toml`-ja dönti
  el, nem a shell PATH-ja. A `launchd` plist abszolút útvonalon hívja a `mise`-t,
  és az oldja fel a repó pinjeit — mert a `.zshrc` interaktív shellre szól, egy
  háttérszolgáltatás nem látja sem a `mise activate`-et, sem a `PNPM_HOME`-ot.
- **Naplózás:** a mag már struktúrált eseményeket bocsát ki, tehát a napló ennek
  egy nyelője — futásonként egy JSON-soros fájl, mellette olvasható konzolkimenet.
  Nem külön tervezési kérdés, hanem a 2. fejezet döntésének hozadéka.
- **Újraindulás köteg közben:** az állapottár kezeli; az újrafuttatás folytat.

## 13. Amit szándékosan nem építünk

- **Darabolás és map-reduce összefűzés** — a mérés szerint minden átirat elfér egy
  kontextusablakban.
- **Versengő stílusváltozatok és válogató ágens** — az evaluator–optimizer loop
  ugyanazt éri el olcsóbban és átláthatóbban.
- **Filesystem watcher** — lásd a 10. fejezetet.
- **Plugin-loader, DI-konténer, event bus** — a méret nem indokolja.
- **Provider-váltó réteg az alkalmazásban** — a routingot, a tartalék-útvonalat és
  a terheléselosztást a LiteLLM végzi.
- **Publikus kitettség, tunnel, autentikációs réteg** — a rendszer egy privát
  hálózaton belül marad.
- **n8n (vagy más munkafolyamat-motor) a v1 motorjaként** — a döntési történet maga is a projekt
  értéke, és azt egy vizuális folyamatábra nem adja vissza.
- **LLM-generált cikk automatikus publikálása** mások videóiból.

## 14. Nyitott pontok

Őszintén, hogy ne tűnjenek eldöntöttnek:

- **A havi költségkeret konkrét összege** nincs meghatározva.
- **A lokális transzkripció sebességbecslése** (nagyjából három–nyolcszoros valós
  idő) átvett érték, nem saját mérés. Az első futás után pontosítandó.

**Lezárva: az Evalite aktuális API-ja.** A verzió- és API-döntéseket
2026-09-01-én verifikáltuk, a [Fázis 1 terv](<./plans/2026-09-01-fazis-1-elso-recept.md>)
„Amit a megvalósítás előtt verifikáltunk" szakaszában rögzítve. Az alábbi
`better-sqlite3`-inkompatibilitás és az override viszont csak a 14. feladat
végrehajtása közben derült ki — ezt a terv „Végrehajtás" szakasza
dokumentálja:

- A stabil `evalite@0.19.0` van pinnelve. Az `1.0.0-beta.16` sor peer-je
  `ai: ^6`, ami ütközik a projekt `ai@^7`-es függőségével — a beta emiatt
  kiesett.
- Az `evalite` tranzitív függősége, a `better-sqlite3`, `^11.6.0`-t deklarál,
  de az nem fordul a pinnelt Node `26.2.0`-n — **valódi V8 API-eltávolítás,
  nem hiányzó fordítói lánc.** Egy `pnpm-workspace.yaml` `overrides` bejegyzés
  `^13.0.3`-ra emeli, ami natív fordítási szinten **és** JS/futásidejű
  szinten is verifikáltan helyesen működik.
- Az `evalite` saját `@vitest/runner@^4` függősége miatt a projekt Vitest
  3-ról 4-re frissült — kipróbálva: nulla kódváltoztatással zöld maradt
  minden korábbi teszt.
