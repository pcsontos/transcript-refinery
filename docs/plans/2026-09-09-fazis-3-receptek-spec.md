# Spec — Két új recept és a strukturált kimenet (Fázis 3, első szelet)

**Dátum:** 2026-09-09 · **Státusz:** jóváhagyásra vár

Ez a dokumentum a [`roadmap.md`](<../roadmap.md>) Fázis 3 szakaszának **első
két** sikerkritériumát specifikálja. A harmadik — a publikált mérés arról,
javít-e a második iteráció — külön szelet, saját speckel és tervvel, ez után.
Az implementációs terv ebből készül; a végrehajtó mindkettőt olvassa.

## A cél egy mondatban

Bizonyítsuk **működő kóddal**, hogy egy új dokumentumtípus felvétele nem
architekturális esemény: egy prózarecept egyetlen új fájl a motor érintése
nélkül, egy strukturált recept pedig sémával kikényszerített kimenetet ad, a
vault által várt sorformátumban.

## Kiindulási állapot

- `src/recipe/types.ts:21` — a `Recipe` ma **csak szöveget** ismer: `prompt` és
  `repairPrompt` stringet ad, séma és renderer nincs. A
  [`0002`](<../decisions/0002-dokumentumtipus-egyseg.md>) viszont expliciten
  megelőlegezte az „opcionális séma, opcionális renderer" mezőket.
- `src/refine/loop.ts:41` és `:55` — a loop mindkét generálási pontja
  `client.generate(...)`-et hív, tehát a kimenet mindig string.
- `src/model/client.ts:22` — a `ModelClient`-en **létezik** `generateObject`, és
  a Fázis 2 újrapróbálkozó dekorátora is becsomagolja, de a recept-úton ma
  senki nem hívja.
- `src/recipe/registry.ts:12` — statikus registry, egyetlen bejegyzéssel
  (`summary`). Új recept felvétele két sor: egy import és egy bejegyzés.
- `src/recipe/summary.ts:11` — a vault-invariáns szabályok (`RULES`) ma a
  `summary` receptbe vannak zárva, pedig mindhárom receptnek ugyanazok kellenek.
- `src/rubric/format.ts` — determinisztikus, nulla tokenes kapu: üres jegyzet,
  wikilink, hibás linkcél, páratlan kódkerítés, tiltott frontmatter. Kártya-
  specifikus szabályt nem ismer.
- `src/rubric/judge.ts:51` és `:66` — a hűség- és lefedettség-bíró promptjai „a
  set of notes"-ról beszélnek, tehát nem recept-specifikusak.
- `src/vault/render.ts:47` — a jegyzettörzs `# Cím`, opcionális linksor, `---`,
  majd a tartalom. A `##` szintű fejlécek szabadon használhatók a tartalomban.
- `src/vault/publish.ts:34` — meglévő fájlt csak `--force` ír felül.
- `src/cli.ts:46` — a `--recipe` súgósora **nem sorolja fel** a recepteket, és a
  `getRecipe` hibaüzenete a registryből épül: új recept nem kényszerít
  CLI-módosítást.

## 1. A motorvarrat — strukturált kimenet

A `Recipe` egyetlen opcionális mezőt kap. A típusparaméter **záráson belül**
marad, tehát a hívási láncba nem szivárog sem generikus, sem `unknown`:

```ts
export interface StructuredOutput {
  /** Sémával kikényszerített generálás → kész, renderelt Markdown. */
  generate(
    client: ModelClient,
    role: ModelRole,
    prompt: string,
  ): Promise<ModelResult<string>>
}

export interface Recipe {
  /* ...a mai mezők változatlanul... */
  /** Ha jelen van, a generálás objektumot kér a sémára, és azt rendereli. */
  structured?: StructuredOutput
}

/** A tipizált építő: kifelé konkrét típus, befelé teljes típusbiztonság. */
export function structuredOutput<T>(
  schema: ZodType<T>,
  render: (value: T) => string,
): StructuredOutput
```

A `refine` loop egyetlen segédfüggvényt kap, amit az első generálás és a javító
kör is használ:

```ts
const generate = (prompt: string) =>
  recipe.structured
    ? recipe.structured.generate(client, recipe.role, prompt)
    : client.generate(recipe.role, prompt)
```

Innentől mindkét ág stringet ad vissza, tehát a pontozás, a legjobb kimenet
követése, a nem-javulási őr és a token-elszámolás **változatlan**. A
`RepairInput.previous` strukturált receptnél is a renderelt Markdown: a modell
azt látja, amit valójában előállított; hogy objektumot kell visszaadnia, azt a
séma kényszeríti ki.

Nulla sort változik: `registry.ts` típusai, `RecipeDeps`, `runRecipe`, a
publisher, a `renderRecipeNote`, a rubrika-motor és a `ModelClient`.

## 2. Közös szabályok kiemelése

A `summary.ts` `RULES` konstansából a **vault-invariáns** rész átkerül
`src/recipe/rules.ts`-be: a felirat nyelvén írj, minden állítás visszavezethető,
nincs frontmatter, nincs wikilink, a linkcél szögletes zárójelben. A
recept-specifikus szabályt (például a `summary` hossz-arányát) minden recept
maga fűzi hozzá.

A kiemelés köti magát egy feltételhez: a `summary` **összeállított promptja
bájtra azonos** marad a maival. A mai `RULES`-ban a hossz-szabály úgyis utolsó,
tehát a sorrend megtartható. A 7. sikerkritérium pontosan ezt méri: a `summary`
meglévő tesztjei módosítás nélkül futnak.

## 3. Tanulókártya recept — strukturált

Fájl: `src/recipe/flashcards.ts`, kimenet: `_flashcards.md`, `publishable: true`,
`role: 'draft'`, `maxIterations: 2`, küszöb 0,8.

```ts
const Card = z.object({ question: z.string().min(1), answer: z.string().min(1) })
const FlashcardsSchema = z.object({ cards: z.array(Card).min(3) })

const renderCards = ({ cards }: Flashcards): string =>
  cards.map((c) => `## ${c.question}\n\n${c.answer}`).join('\n\n')
```

A prompt kártyánként egy gondolatot kér, egy tipikus videóra nagyjából 8–15
kártyát; a séma alsó korlátja három. Felső korlátot a séma nem ír elő — a
hosszabb átirat több kártyát érdemel, és a költséget a Fázis 2 plafonja fogja.

A cél-formátum az Obsidian **Decks** plugin fejléc-bekezdés alakja: minden `##`
fejléc egy kártya eleje, az alatta lévő bekezdés a hátulja. A meglévő
jegyzettörzsbe (`# Cím`, `---`, tartalom) ütközésmentesen illeszkedik.
**Deck-tag nem kerül a jegyzetbe**: a Decks a jegyzet és a mappa szerkezetéből
szervezi a paklikat, a jegyzeteink pedig `Inbox/transcript-refinery/<forrás>/`
alatt élnek.

### Kártya-specifikus formátum-kapu

A kártyarecept rubrikája négy kritériumból áll — `[formatCriterion,
flashcardFormatCriterion, faithfulnessCriterion, coverageCriterion]` —, ahol az
első kettő **blokkoló**: az általános vault-szabályokat a meglévő kapu őrzi, a
kártya-alakot az új.

A védelem viszont **két rétegű**, mert nem minden hiba látszik ugyanott:

**A renderer normalizál** azoknál az eseteknél, amiket a kész szövegből már nem
lehetne kimutatni. Ha a kérdésbe sortörés kerül, a renderelt szövegben a
sortörés utáni rész megkülönböztethetetlen a válasz első sorától; ha a válasz
`##`-cal kezdődő sort tartalmaz, az megkülönböztethetetlen egy új kártya
fejlécétől. Kapu tehát nem is tudná elkapni őket. A renderer ezért a kérdés
sortöréseit szóközzé olvasztja, a válasz `#`-kezdetű sorait pedig escape-eli —
ugyanaz a megoldás, amit a Fázis 2 riportja használ a táblacellák `|` jelére.
Így ezek az esetek nem hibává, hanem helyes kimenetté válnak.

**A kapu azt fogja meg, ami a renderelt szövegből tényleg látszik:**

| eset | miért baj |
|---|---|
| ismétlődő kérdés | két kártya azonos előlappal — a séma ezt nem nézi |
| válasz nélküli fejléc | üres kártya a paklikban |
| háromnál kevesebb kártya | védelmi ellenőrzés a renderer hibája ellen |

A csupa szóköz oldalt nem a kapu, hanem a **séma** szűri (`z.string().trim().min(1)`).

Minden kapu-eset **angol nyelvű gap-üzenetet** ad, mert az visszamegy a javító
promptba.

### Séma-hiba

Ha a modell nem a sémának megfelelő kimenetet ad, a `generateObject` dob, az
elem `item:failed` lesz, a Fázis 2 riportja megnevezi az okot, és a
`--retry-failed` előveheti. Ez tudatos: egy sémát eltévesztő modelltől újabb
kört rendelni pénzbe kerül és ritkán segít. A nyers SDK-hiba érthető magyar
üzenetbe csomagolva jelenik meg.

## 4. Kérdés-felelet recept — próza

Fájl: `src/recipe/qa.ts`, kimenet: `_qa.md`, `publishable: true`,
`role: 'draft'`, `maxIterations: 2`, rubrika = formátum + hűség + lefedettség,
küszöb 0,8 — vagyis pontosan a `summary` felállása. A prompt kérdés-felelet
párokat kér prózában; a saját szabálya az, hogy minden kérdés az átiratból
megválaszolható legyen.

**Ez a recept nulla motor-sort igényel.** Ezért kerül be utolsóként: a commitja
hordozza az első sikerkritérium bizonyítékát.

## Megkötések

- Magyar dokumentáció, kódkomment, felhasználói kimenet és commit-üzenet; angol
  produkciós azonosító. A modellnek szóló promptok és gap-üzenetek angolul.
- A mag nem ír konzolra és nem ír fájlt: a receptek eseményt és kimenetet adnak.
- Minden teszt hálózat és API-kulcs nélkül fut, a meglévő hamis kliens mintát
  követve. Modellhívás egyetlen tesztben sincs.
- A rubrika-motor, a publisher és a `ModelClient` felülete nem változik.
- Recept nem kerülhet be a rubrikája nélkül.
- Commit-sorrend: (1) motorvarrat + szabálykiemelés, (2) kártyarecept,
  (3) Q&A recept.

## Sikerkritériumok

Megfigyelhető viselkedés, nem fájltartalom:

1. A Q&A commit `git show --stat`-ja két új fájlt (recept és tesztje) és a
   registry két sorát mutatja; a
   `git show <commit> -- src/pipeline.ts src/refine src/rubric src/model src/cli.ts`
   **üres kimenetet** ad.
2. `run --recipe qa` egyetlen elemre olyan jegyzetet ír, amit a vault-linter
   átenged, és aminek a frontmatterében ott a recept, a modell, az
   iterációszám, a pontszám és a költség.
3. `run --recipe flashcards` egyetlen elemre olyan jegyzetet ír, amiben **minden
   kártya** `##` fejléc plusz nem üres bekezdés, és a kártyák száma legalább
   három.
4. Ha a modell sortörést tesz egy kérdésbe, a jegyzetben **attól még nem esik
   szét kártya**: a kérdés egyetlen `##` sorban áll, és a kártyák száma
   változatlan. Ha két kártya ugyanazt kérdezi, a futás **nulla bíró-hívással**
   megáll a kapun, és a gap-üzenet megnevezi az ismételt kérdést.
5. Ha a modell séma-sértő kimenetet ad, az elem `item:failed` lesz, a riport
   „Hibák" szakasza megnevezi az elemet és az okot, a köteg pedig végigmegy.
6. A `refine` loop strukturált recepttel is végigviszi a javító kört: a második
   generálás is a sémás úton megy, és a pontozás a renderelt Markdownra
   történik.
7. A `summary` recept viselkedése változatlan: a meglévő tesztjei és az
   `evals/summary.eval.ts` módosítás nélkül futnak.

## Amit ez a szelet szándékosan nem tartalmaz

- **A mérés** — hogy javít-e a második iteráció, mennyivel és mennyiért. Ez a
  Fázis 3 harmadik kritériuma, külön spec és terv.
- **Eval-fájlok az új receptekhez** (`evals/qa.eval.ts`, `evals/flashcards.eval.ts`)
  és a hozzájuk tartozó fixture-adat: a mérési szelethez tartoznak.
- **A bíró-promptok paraméterezése** recept-típusra. Ismert kockázat, hogy a
  hűség-bíró a kártya kérdés-felét állításnak nézi; ha a mérés kimutatja, olcsó
  javítani, de előre nem optimalizálunk rá.
- **Deck-tag logika** és bármilyen Decks-specifikus konfiguráció a rendereren túl.
- **Harmadik prózarecept** (tanulási útmutató, cikkvázlat): a bővítési költséget
  kettő is bizonyítja.
