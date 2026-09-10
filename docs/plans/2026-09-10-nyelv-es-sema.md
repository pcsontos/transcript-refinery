# A nyelvi sodródás és a sémás kimenet javítása — implementációs terv

> **Ágenseknek:** KÖTELEZŐ AL-SKILL: `superpowers:subagent-driven-development`
> (ajánlott) vagy `superpowers:executing-plans` a feladatonkénti végrehajtáshoz.
> A lépések jelölőnégyzetes (`- [ ]`) szintaxist használnak.

**Cél:** A pilóta három hibájának javítása, hogy a mérés olyan rendszeren
fusson le, amiről érdemes bármit is állítani — és a javítás bizonyítása
valódi hívással, nem csak fake-ekkel.

**Architektúra:** Egy új, függőségmentes nyelvazonosító (`src/lang/`) két
fogyasztót szolgál ki: a promptot, ami kimondja a jegyzet nyelvét, és egy új
blokkoló rubrika-kaput, ami a kimenet nyelvét az átirathoz méri. A modellréteg
egyetlen beállítást kap, és egy `fetch` varratot, amin a kimenő kérés
ellenőrizhető. A `refine` loop **nem változik**.

**Tech stack:** TypeScript 5.9, Node 26.2, pnpm 11.24, vitest 4, zod 4,
Vercel AI SDK 7 LiteLLM gateway mögött. **Új függőség nincs.**

**Spec:** `docs/plans/2026-09-10-nyelv-es-sema-spec.md`

## Globális megkötések

- **Egyetlen teszt sem hív modellt.** A Feladat 6 füstpróbája kézzel indul, a
  tesztfutáson kívül, és a felhasználó megerősítése után.
- Minden parancs `mise exec --` alatt fut (`mise exec -- pnpm test`).
- Magyar a dokumentáció, a kódkomment, a felhasználói kimenet és a
  commit-üzenet; **angol** a produkciós azonosító, a prompt és minden
  hiányüzenet, ami visszamegy a modellnek.
- Nincs közvetlen munka a `main` ágon. Az ág: `fix/nyelv-es-sema`.
- A commit-üzenetek **nem tartalmaznak attribúciós láblécet**.
- Korpuszrészlet nem kerülhet a repóba — sem tesztbe, sem dokumentumba. Minden
  mintaszöveg saját írású.
- Minden feladat végén zöld: `pnpm test`, `pnpm typecheck`, `pnpm lint`.

## Fájlszerkezet

| fájl | felelősség |
|---|---|
| `src/model/client.ts` *(módosít)* | `supportsStructuredOutputs`, `fetch` varrat |
| `src/model/client.test.ts` *(módosít)* | a kimenő kérés törzsének regressziós tesztje |
| `src/lang/identify.ts` *(új)* | nyelvazonosítás funkciószavakból, nyelvnév |
| `src/lang/identify.test.ts` *(új)* | a felismerés és a „nem tudom" ágak |
| `src/rubric/language.ts` *(új)* | blokkoló nyelvi kapu |
| `src/rubric/language.test.ts` *(új)* | a kapu ítéletei, nulla bíró-hívással |
| `src/recipe/rules.ts` *(módosít)* | `RULE.language` → `languageRule(item)` |
| `src/recipe/{summary,qa,flashcards}.ts` *(módosít)* | `Channel:` ki, kapu be |
| `docs/decisions/0009-nyelvi-kapu.md` *(új)* | a döntés rögzítése |

---

## Feladat 1: A sémás kimenet

**Fájlok:**
- Módosít: `src/model/client.ts:72-77`
- Módosít: `src/model/client.test.ts`

**Interfészek:**
- Fogyaszt: semmit korábbi feladatból — ez a feladat független, ezért áll elöl.
- Termel: `createModelClient(cfg: ModelConfig, fetch?: typeof globalThis.fetch)`.
  A második paraméter **kizárólag tesztből** kap értéket.

> **Miért működik a `typeof globalThis.fetch`.** Az SDK `FetchFunction`
> típusa szó szerint `typeof globalThis.fetch`
> (`@ai-sdk/provider-utils@5.0.36`, `dist/index.d.ts:793`). Nem kell hozzá
> import, és nem lesz belőle új közvetlen függőség.

- [ ] **1. lépés: Írd meg a bukó tesztet**

`src/model/client.test.ts` — a meglévő importok mellé:

```ts
import { createModelClient, modelClientFrom } from './client.js'
import type { ModelConfig } from '../config.js'
```

A fájl végére, a `describe('modelClientFrom', ...)` blokk **után**:

```ts
const CFG: ModelConfig = {
  baseUrl: 'https://gateway.example/v1',
  apiKey: 'teszt-kulcs',
  models: { draft: 'draft-model', judge: 'judge-model' },
  pricing: {
    draft: { inputPerMillion: 1, outputPerMillion: 1 },
    judge: { inputPerMillion: 1, outputPerMillion: 1 },
  },
  costLimitUsd: 1,
}

/**
 * Hamis `fetch`: elkapja a kimenő kérés törzsét, és konzerv választ ad.
 *
 * Ez az egyetlen módja annak, hogy a **ténylegesen elküldött** kérésről
 * állítsunk valamit. Egy olyan teszt, ami azt nézi, hogy a kliens
 * `supportsStructuredOutputs: true`-val hívja a providert, a konfigurációt
 * ismételné meg, nem a viselkedést írná le.
 */
function keresElkapo(): {
  torzs: () => Record<string, unknown>
  fetch: typeof globalThis.fetch
} {
  let latott: Record<string, unknown> | undefined
  const fetch: typeof globalThis.fetch = (_input, init) => {
    latott = JSON.parse(String(init?.body)) as Record<string, unknown>
    return Promise.resolve(
      new Response(
        JSON.stringify({
          id: 'chatcmpl-1',
          object: 'chat.completion',
          created: 1,
          model: 'draft-model',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: '{"answer":"igen"}' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
  }
  return { torzs: () => latott!, fetch }
}

describe('createModelClient', () => {
  it('a kimenő kérés a sémát viszi, nem csak „adj JSON-t" utasítást', async () => {
    const elkapo = keresElkapo()
    const client = createModelClient(CFG, elkapo.fetch)

    const result = await client.generateObject(
      'draft',
      'kérdés',
      z.object({ answer: z.string() }),
    )

    expect(result.value).toEqual({ answer: 'igen' })

    const rf = elkapo.torzs().response_format as {
      type: string
      json_schema?: { schema?: { properties?: Record<string, unknown> } }
    }
    // A javítás előtt itt `json_object` áll, séma nélkül: a modell csak annyit
    // tud, hogy „valamilyen JSON-t adj", a mezőket nem.
    expect(rf.type).toBe('json_schema')
    expect(rf.json_schema?.schema?.properties).toHaveProperty('answer')
  })
})
```

- [ ] **2. lépés: Futtasd — buknia kell**

```bash
mise exec -- pnpm vitest run src/model/client.test.ts
```

Várt: a `createModelClient` teszt **elhasal**. A hibaüzenet két lépcsőben
jöhet:

- ha a `createModelClient` még nem fogad `fetch`-et: a teszt **időtúllépéssel**
  bukik 5000 ms után, mert a valódi hálózatot próbálja
- miután a `fetch` varrat bekerült, de a beállítás még nem:
  `AssertionError: expected 'json_object' to be 'json_schema'`

Mindkettő helyes bukás. A második az igazi bizonyíték.

- [ ] **3. lépés: Tedd be a varratot és a javítást**

`src/model/client.ts`, a `createModelClient` fejét és a provider hívását
cseréld erre:

```ts
export function createModelClient(
  cfg: ModelConfig,
  fetch?: typeof globalThis.fetch,
): ModelClient {
  const provider = createOpenAICompatible({
    name: 'litellm',
    baseURL: cfg.baseUrl,
    apiKey: cfg.apiKey,
    // E nélkül a séma **nem hagyja el a gépet**: az SDK alapértelmezése
    // hamis (`@ai-sdk/openai-compatible@3.0.43`, `dist/index.js:447`), és
    // akkor `{ type: "json_object" }` megy ki a `json_schema` helyett
    // (`:569`). A pilótán ettől lett a `flashcards` 0/5.
    supportsStructuredOutputs: true,
    // Kizárólag a teszt adja meg: így a kimenő kérés törzse valódi hálózat
    // nélkül ellenőrizhető.
    ...(fetch ? { fetch } : {}),
  })
```

A függvény többi része változatlan.

- [ ] **4. lépés: Futtasd — át kell mennie**

```bash
mise exec -- pnpm vitest run src/model/client.test.ts
```

Várt: minden teszt zöld.

- [ ] **5. lépés: Teljes ellenőrzés**

```bash
mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint
```

- [ ] **6. lépés: Commit**

```bash
git add src/model/client.ts src/model/client.test.ts
git commit -m "$(cat <<'EOF'
fix(model): a séma tényleg elmegy a modellnek

- `supportsStructuredOutputs: true`, e nélkül `json_object` ment séma helyett
- `fetch` varrat, hogy a kimenő kérés törzse teszttel ellenőrizhető legyen
- A teszt a mai kódon `json_object`-ra bukik, nulla modellhívásból

Refs #18
EOF
)"
```

---

## Feladat 2: A nyelvazonosító

**Fájlok:**
- Létrehoz: `src/lang/identify.ts`
- Test: `src/lang/identify.test.ts`

**Interfészek:**
- Fogyaszt: semmit.
- Termel:
  - `LANGUAGE_NAMES` — `Record<LanguageTag, string>`, tag → angol név
  - `type LanguageTag` — `'en' | 'hu' | 'nl' | 'de' | 'es' | 'fr' | 'it'`
  - `identifyLanguage(text: string): LanguageTag | null`
  - `languageName(tag: string | null): string`

- [ ] **1. lépés: Írd meg a bukó teszteket**

`src/lang/identify.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { identifyLanguage, languageName, LANGUAGE_NAMES } from './identify.js'

/**
 * Minden mintaszöveg **saját írású**. A valós korpusz privát, és egy
 * korpuszrészlet a repóba kerülve kiszivárogtatná.
 */
const ANGOL_JEGYZET = `This video walks through how a service mesh handles traffic between pods.

## What the sidecar does
- Every pod gets a proxy container injected next to the application container.
- The application talks to localhost, and the proxy takes care of retries.
- Because the proxy sees every request, it can report latency without any
  change to the code.

## Why mutual TLS matters here
The speaker argues that the interesting part is not encryption on its own, but
identity. Each workload gets a certificate that names it, so a policy can say
which service is allowed to call which other service. Without that identity, a
network policy can only reason about addresses, and addresses move.`

const HOLLAND_JEGYZET = `Deze video legt uit hoe een service mesh het verkeer tussen pods afhandelt.

## Wat de sidecar doet
- Elke pod krijgt een proxy container naast de applicatie container.
- De applicatie praat met localhost, en de proxy zorgt voor herhalingen.
- Omdat de proxy elk verzoek ziet, kan hij de latentie rapporteren zonder dat
  de code verandert.

## Waarom wederzijdse TLS hier belangrijk is
De spreker stelt dat het interessante deel niet de versleuteling op zichzelf
is, maar de identiteit. Elke werklast krijgt een certificaat dat hem benoemt,
zodat een beleid kan zeggen welke service welke andere service mag aanroepen.`

const MAGYAR_JEGYZET = `Ez a videó azt mutatja be, hogyan kezeli egy service mesh a podok közötti forgalmat.

## Mit csinál a sidecar
- Minden pod mellé bekerül egy proxy konténer az alkalmazás konténere mellé.
- Az alkalmazás a localhosttal beszél, a proxy pedig elintézi az
  újrapróbálkozásokat.
- Mivel a proxy minden kérést lát, jelenteni tudja a késleltetést anélkül,
  hogy a kódhoz hozzá kellene nyúlni.

## Miért fontos itt a kölcsönös TLS
Az előadó szerint nem maga a titkosítás az érdekes, hanem az identitás. Minden
munkaterhelés kap egy tanúsítványt, ami megnevezi őt, így egy szabály ki tudja
mondani, melyik szolgáltatás hívhat meg melyik másikat.`

describe('identifyLanguage — felismerés', () => {
  it('angol jegyzetet angolnak ismer fel', () => {
    expect(identifyLanguage(ANGOL_JEGYZET)).toBe('en')
  })

  it('holland jegyzetet hollandnak ismer fel — ez volt a megfigyelt hiba', () => {
    expect(identifyLanguage(HOLLAND_JEGYZET)).toBe('nl')
  })

  it('magyar jegyzetet magyarnak ismer fel', () => {
    expect(identifyLanguage(MAGYAR_JEGYZET)).toBe('hu')
  })

  it('a kódnehéz kártyalapot is angolnak ismeri fel', () => {
    const kartyak = `## What flag enables the proxy?
\`--sidecar-inject=true\`

## Which port does the proxy listen on?
15001

## What does this command print?
\`kubectl get pods -n istio-system -o wide\`

## What is the default mTLS mode?
PERMISSIVE`
    expect(identifyLanguage(kartyak)).toBe('en')
  })

  it('a szakszavak nem viszik el: magyar kifejezésekkel is angol marad', () => {
    // A tartalmi szavak átszivárognak a nyelvek között, a funkciószavak nem.
    // Ezért mérünk funkciószavakkal.
    const kevert = `The speaker uses the Hungarian term "kubernetes fürt" throughout,
but the notes below are in English. A fürt is simply a cluster, and the
csomópont is a node. Despite these borrowed words, every sentence here follows
English grammar and English function words, so the note should still be
identified as English by any reasonable measure of the text.`
    expect(identifyLanguage(kevert)).toBe('en')
  })
})

describe('identifyLanguage — amikor nem tudja', () => {
  it('profilon kívüli nyelvre nem talál ki ítéletet (lengyel)', () => {
    const lengyel = `Ten film pokazuje, w jaki sposób siatka usług obsługuje ruch
między podami. Każdy pod otrzymuje kontener proxy obok kontenera aplikacji, a
aplikacja rozmawia z localhost. Ponieważ proxy widzi każde żądanie, może
raportować opóźnienia bez zmiany kodu aplikacji.`
    expect(identifyLanguage(lengyel)).toBeNull()
  })

  it('a török mintát az ARÁNY-őr fogja meg, nem a fölény', () => {
    // Fontos eset: itt a futam-második NULLA találat, tehát a fölény
    // végtelen. Ha csak fölényre szűrnénk, a modul magabiztosan angolt
    // mondana egy török szövegre.
    const torok = `Bu video, bir servis ağının podlar arasındaki trafiği nasıl
yönettiğini anlatıyor. Her pod uygulama kabının yanına bir proxy kabı alır ve
uygulama localhost ile konuşur.`
    expect(identifyLanguage(torok)).toBeNull()
  })

  it('nem latin betűs szövegre null', () => {
    expect(
      identifyLanguage(
        'このビデオでは、サービスメッシュがポッド間のトラフィックをどのように処理するかを説明します。',
      ),
    ).toBeNull()
  })

  it('csak kódra null', () => {
    const kod = `\`\`\`yaml
apiVersion: v1
kind: Pod
metadata:
  name: proxy
spec:
  containers:
    - image: envoy:1.29
      ports: [15001, 15006]
\`\`\``
    expect(identifyLanguage(kod)).toBeNull()
  })

  it('a négyszavas angolt a FÖLÉNY-őr fogja meg, nem az arány', () => {
    // Fontos eset: az arány 0,25, bőven a küszöb fölött. Csak a fölény —
    // 1,00× — állítja meg. Ha csak arányra szűrnénk, egy négyszavas mondat
    // érmefeldobással kapna nyelvet.
    expect(identifyLanguage('Pods share a network.')).toBeNull()
  })

  it('üres szövegre null, nem nullával osztás', () => {
    expect(identifyLanguage('')).toBeNull()
    expect(identifyLanguage('   \n\t  ')).toBeNull()
  })
})

describe('languageName', () => {
  it('a fájlnév-utótagból angol nyelvnevet ad', () => {
    expect(languageName('en')).toBe('English')
    expect(languageName('hu')).toBe('Hungarian')
    expect(languageName('nl')).toBe('Dutch')
  })

  it('a régióváltozatot a nyelvre vezeti vissza', () => {
    expect(languageName('en-US')).toBe('English')
    expect(languageName('EN-GB')).toBe('English')
  })

  it('hiányzó vagy ismeretlen tagnál angol az alapértelmezés', () => {
    // Az `item.language` a fájlnév utótagja, ami hiányozhat is. A tartalék
    // szándékos döntés, nem véletlen: lásd `0009`.
    expect(languageName(null)).toBe('English')
    expect(languageName('pt')).toBe('English')
    expect(languageName('')).toBe('English')
  })

  it('minden megnevezhető nyelvhez tartozik név', () => {
    for (const [tag, nev] of Object.entries(LANGUAGE_NAMES)) {
      expect(nev.length).toBeGreaterThan(0)
      expect(languageName(tag)).toBe(nev)
    }
  })
})
```

- [ ] **2. lépés: Futtasd — buknia kell**

```bash
mise exec -- pnpm vitest run src/lang/identify.test.ts
```

Várt: `Failed to resolve import "./identify.js"` — a modul még nincs meg.

- [ ] **3. lépés: Írd meg a modult**

`src/lang/identify.ts`:

```ts
/**
 * Nyelvazonosítás funkciószavakból — determinisztikus, nulla token, nulla
 * függőség.
 *
 * A módszer azon áll, hogy a funkciószavak (névelő, kötőszó, névmás,
 * elöljáró) minden nyelvben a szöveg nagy részét kiteszik, és nyelvenként
 * mások. A **tartalmi** szavak — amik szakszövegben át is szivárognak más
 * nyelvekből — így nem torzítanak.
 *
 * A modul **nem találgat**: ha nem elég erős a jel, `null`-t ad. A hívó ezt
 * átengedésnek veszi (`rubric/language.ts`), mert egy téves ítélet egy
 * helyes jegyzetet buktatna meg.
 */

/** A megnevezhető nyelvek és angol nevük. A prompt ezt a nevet mondja ki. */
export const LANGUAGE_NAMES = {
  en: 'English',
  hu: 'Hungarian',
  nl: 'Dutch',
  de: 'German',
  es: 'Spanish',
  fr: 'French',
  it: 'Italian',
} as const

export type LanguageTag = keyof typeof LANGUAGE_NAMES

/**
 * Nyelvenként 50–80 funkciószó. A holland azért van a listán, mert a
 * megfigyelt hiba pontosan az volt (`0009`).
 *
 * A listák a valós korpuszon mérve lettek kiválasztva, nem elméletből: lásd
 * a spec „Amit a küszöbök megválasztása előtt megmértünk" szakaszát.
 */
const PROFILES: Record<LanguageTag, string> = {
  en: 'the of and to a in is it that you i we they he she for on with as at by this but not are was be have has had do does did from or an if then there their our your my me him her them what which who when where how all can will would should could about into over after before more most other some such no nor only own same so than too very just',
  hu: 'a az és hogy nem is de vagy egy mint már csak ez ezt ezek akkor ha van volt lesz lehet kell meg el ki be fel le át rá ide oda itt ott így úgy amikor ahol aki ami amit annak ennek mert hiszen tehát pedig azonban viszont szerint között alatt fölött után előtt nélkül miatt által vagyok vagyunk vannak voltam nagyon még sem se minden semmi valami',
  nl: 'de het een en van is in dat op te zijn met voor niet aan er maar om die als dan ook nog wel naar door over bij uit al kan zou moet heeft hebben was werd worden deze dit hun onze jouw mijn wat welke wie waar hoe alle veel meer heel zo want dus echter tussen onder boven na zonder omdat wordt hij zij ze we ik jij',
  de: 'der die das und ist in den von zu mit sich auf für nicht ein eine als auch es an werden aus er hat dass sie nach bei um noch wie über nur oder aber vor durch man sein wurde sind einem einen einer dem des im am zum zur kann muss soll wenn dann weil damit zwischen unter ohne gegen schon immer sehr',
  es: 'el la de que y en los las un una por con no se para es al del lo como más pero sus le ya o este sí porque esta entre cuando muy sin sobre también me hasta hay donde han quien está desde todo nos durante todos uno les ni contra otros ese eso',
  fr: 'le la de et les des en un une du dans il que pour qui sur ne pas ce se au plus par avec son sont mais ou où comme sa tout nous vous ils elle été être avoir fait cette ces leur bien sans peut aussi deux même y a je te lui dont',
  it: 'il di che la e un per non in una sono con si le da mi ha ma come lo se ci hai ho perché cosa quando anche questo tutto della dei alla nel sul più molto quindi però tra sotto sopra dopo prima senza essere avere fare',
}

const SETS = Object.entries(PROFILES).map(
  ([tag, lista]) => [tag as LanguageTag, new Set(lista.split(' '))] as const,
)

/**
 * Minimális találati arány. A valós korpuszon a leggyengébb angol átirat
 * 0,410-et, a leggyengébb jegyzet alakú minta 0,343-at ért el; a profilon
 * kívüli nyelvek 0,027 és 0,040 között maradtak. A 0,15 e két tartomány
 * között áll, mindkét irányban tartalékkal.
 */
const MIN_RATE = 0.15

/**
 * Minimális fölény a futam-második fölött. A leggyengébb valódi találat
 * 2,50×-et hozott; a kiegyenlített hamis jelöltek 1,00×-en állnak.
 */
const MIN_MARGIN = 1.5

/** Szavakra bontás: minden, ami nem betű, elválasztó. */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter((w) => w !== '')
}

/**
 * A szöveg nyelve, vagy `null`, ha a jel nem elég erős.
 *
 * **A két őr külön eseteket fog meg, ezért egyik sem elhagyható.** Egy török
 * szövegen a futam-második nulla találat, tehát a fölény végtelen — ott csak
 * az arányőr állít meg. Egy négyszavas angol mondaton az arány 0,25, bőven a
 * küszöb fölött — ott csak a fölényőr állít meg.
 */
export function identifyLanguage(text: string): LanguageTag | null {
  const tokens = words(text)
  if (tokens.length === 0) return null

  const rates = SETS.map(([tag, set]): [LanguageTag, number] => [
    tag,
    tokens.filter((w) => set.has(w)).length / tokens.length,
  ])
  rates.sort((a, b) => b[1] - a[1])

  const [topTag, topRate] = rates[0]!
  const masodik = rates[1]?.[1] ?? 0

  if (topRate < MIN_RATE) return null
  // Nulla futam-második mellett a fölény végtelen; ilyenkor az arányőr az
  // egyetlen kapu, és az már lefutott.
  if (masodik > 0 && topRate / masodik < MIN_MARGIN) return null
  return topTag
}

/**
 * Nyelvi tag → angol név a promptnak.
 *
 * Az `item.language` a feliratfájl nevének utótagja (`en`, `en-US`), ami
 * hiányozhat is. Ismeretlen vagy hiányzó tagnál az alapértelmezés
 * **English** — a döntés indoklása a `0009`-ben.
 */
export function languageName(tag: string | null): string {
  if (tag === null) return LANGUAGE_NAMES.en
  const alap = tag.toLowerCase().split('-')[0]!
  return LANGUAGE_NAMES[alap as LanguageTag] ?? LANGUAGE_NAMES.en
}
```

- [ ] **4. lépés: Futtasd — át kell mennie**

```bash
mise exec -- pnpm vitest run src/lang/identify.test.ts
```

Várt: minden teszt zöld.

- [ ] **5. lépés: Bizonyítsd, hogy mindkét őr teherviselő**

Ez a lépés **mutációval** igazolja, hogy egyik őr sem díszlet. Minden mutáció
után állítsd vissza a fájlt.

> **FIGYELEM: soha ne használj `git checkout -- src/`-t a visszaállításra.**
> Az minden nem commitolt munkát eldob, nem csak a mutációt. Készíts
> fájlonkénti másolatot, és abból állíts vissza.

```bash
cp src/lang/identify.ts /tmp/identify.bak
```

**A mutáció:** töröld az arányőrt (`if (topRate < MIN_RATE) return null`).
Futtasd:

```bash
mise exec -- pnpm vitest run src/lang/identify.test.ts
```

Várt: **a török, a lengyel, a japán és a „csak kód" teszt megbukik.** Ha
mindegyik átmegy, az arányőr felesleges — állj meg, és jelezd.

Állítsd vissza (`cp /tmp/identify.bak src/lang/identify.ts`), majd

**B mutáció:** töröld a fölényőrt (`if (masodik > 0 && ...) return null`).
Futtasd újra.

Várt: **a négyszavas angol teszt megbukik.** Ha átmegy, a fölényőr felesleges
— állj meg, és jelezd.

Állítsd vissza, és ellenőrizd, hogy a fájl azonos az eredetivel:

```bash
cp /tmp/identify.bak src/lang/identify.ts
diff -q /tmp/identify.bak src/lang/identify.ts && git status --short
```

- [ ] **6. lépés: Mérd újra a valós korpuszon**

A spec kiköti: a küszöb akkor marad ez, ha a **végleges** listákkal is
154/154 a korpusz. A korpusz privát, ezért ez **nem teszt**, hanem kézi
ellenőrzés eldobható szkripttel.

Írd a szkriptet a scratchpadbe (a repóba **nem**), és futtasd:

```ts
// /tmp/korpusz-ellenorzes.ts
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { identifyLanguage } from './src/lang/identify.js'

const GYOKER = '<a refinery.config.yaml `sources:` első útvonala>'

function szoveg(raw: string): string {
  return raw
    .split('\n')
    .filter((l) => !/^\d+$/.test(l.trim()))
    .filter((l) => !l.includes('-->'))
    .filter((l) => !/^(WEBVTT|Kind:|Language:|NOTE)/.test(l.trim()))
    .join(' ')
    .replace(/<[^>]+>/g, ' ')
}

function bejar(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) bejar(p, acc)
    else if (/\.(srt|vtt)$/.test(e)) acc.push(p)
  }
  return acc
}

const fajlok = bejar(GYOKER)
const rossz = fajlok.filter((f) => identifyLanguage(szoveg(readFileSync(f, 'utf8'))) !== 'en')
console.log(`${String(fajlok.length - rossz.length)}/${String(fajlok.length)} angol`)
for (const f of rossz) console.log('  eltér:', f)
```

```bash
mise exec -- pnpm tsx /tmp/korpusz-ellenorzes.ts
```

Várt: `154/154 angol`, eltérés nélkül. **Ha nem ez jön ki**, ne igazítsd a
teszteket: a küszöb vagy a szólista a hibás. Írd le, mit kaptál, és jelezd.

- [ ] **7. lépés: Teljes ellenőrzés és commit**

```bash
mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint
git add src/lang/
git commit -m "$(cat <<'EOF'
feat(lang): nyelvazonosítás funkciószavakból

- Hét latin betűs nyelv profilja, függőség nélkül
- Két őr: minimális találati arány és fölény a futam-második fölött
- Gyenge jelnél `null` — a hívó ezt átengedésnek veszi, nem bukásnak
- A küszöbök a valós korpuszon mérve, nem elméletből

Refs #18
EOF
)"
```

---

## Feladat 3: A nyelvi kapu

**Fájlok:**
- Létrehoz: `src/rubric/language.ts`
- Test: `src/rubric/language.test.ts`

**Interfészek:**
- Fogyaszt: `identifyLanguage`, `LANGUAGE_NAMES` (Feladat 2).
- Termel: `checkLanguage(output: string, transcript: string): Score` és
  `languageCriterion: Criterion`.

- [ ] **1. lépés: Írd meg a bukó teszteket**

`src/rubric/language.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { ModelClient } from '../model/client.js'
import { checkLanguage, languageCriterion } from './language.js'
import { scoreRubric, type Criterion } from './types.js'

const ANGOL_ATIRAT = `The speaker explains how a service mesh handles traffic
between pods. He says that every pod gets a proxy container next to the
application container, and that the application only talks to localhost. He
then argues that the interesting part is not encryption but identity, because
a policy can only reason about addresses if it does not know who is calling.`

const ANGOL_JEGYZET = `## What the sidecar does
The proxy sits next to the application container, and the application talks to
localhost. Because the proxy sees every request, it can report latency without
any change to the code of the application itself.`

const HOLLAND_JEGYZET = `## Wat de sidecar doet
De proxy staat naast de applicatie container, en de applicatie praat met
localhost. Omdat de proxy elk verzoek ziet, kan hij de latentie rapporteren
zonder dat de code van de applicatie zelf verandert.`

/**
 * A kliens, amit ezekben a tesztekben nem szabad meghívni. A `rubric/
 * types.test.ts` idiómája, szándékosan azonos alakban.
 */
const nemHivhatoKliens: ModelClient = {
  generate: () => Promise.reject(new Error('a kliens nem hívható itt')),
  generateObject: () => Promise.reject(new Error('a kliens nem hívható itt')),
}

describe('checkLanguage', () => {
  it('az átirattal egyező nyelvű jegyzetet átengedi', () => {
    const score = checkLanguage(ANGOL_JEGYZET, ANGOL_ATIRAT)
    expect(score.value).toBe(1)
    expect(score.gaps).toEqual([])
  })

  it('az eltérő nyelvű jegyzetet megbuktatja — ez a megfigyelt hiba', () => {
    const score = checkLanguage(HOLLAND_JEGYZET, ANGOL_ATIRAT)
    expect(score.value).toBe(0)
    expect(score.gaps).toHaveLength(1)
  })

  it('a hiány MINDKÉT nyelvet megnevezi, angolul', () => {
    // A hiány visszamegy a modellnek a javító promptban, ezért angol. Egy
    // szám nem tud javítást vezérelni: a modellnek tudnia kell, mit írt és
    // mit kellett volna.
    const gap = checkLanguage(HOLLAND_JEGYZET, ANGOL_ATIRAT).gaps[0]!
    expect(gap).toContain('Dutch')
    expect(gap).toContain('English')
    expect(gap).toMatch(/rewrite/i)
  })

  it('ha a jegyzet nyelve ismeretlen, átenged — nem talál ki bukást', () => {
    const csakKod = '```\nkubectl get pods -o wide\n```\n15001 15006'
    expect(checkLanguage(csakKod, ANGOL_ATIRAT).value).toBe(1)
  })

  it('ha az átirat nyelve ismeretlen, átenged', () => {
    expect(checkLanguage(ANGOL_JEGYZET, '15001 15006 envoy 1.29').value).toBe(1)
  })
})

describe('languageCriterion', () => {
  it('blokkoló kapu, nem pontozott összetevő', () => {
    expect(languageCriterion.blocking).toBe(true)
    expect(languageCriterion.name).toBe('language')
  })

  it('a rossz nyelvű kimenet NULLA bíró-hívásba kerül', async () => {
    // Ez a kapu fő haszna a költség oldalán: a drága kritériumok el sem
    // indulnak. A `futott` jelző bizonyítja, hogy egyik sem fut le.
    let futott = false
    const dragaKriterium: Criterion = {
      name: 'draga',
      score: () => {
        futott = true
        return Promise.resolve({ value: 1, gaps: [] })
      },
    }

    const eredmeny = await scoreRubric(
      { criteria: [languageCriterion, dragaKriterium], passThreshold: 0.8 },
      { transcript: ANGOL_ATIRAT, output: HOLLAND_JEGYZET },
      nemHivhatoKliens,
    )

    expect(futott).toBe(false)
    expect(eredmeny.value).toBe(0)
    expect(eredmeny.usage).toEqual({ inputTokens: 0, outputTokens: 0 })
  })
})
```

- [ ] **2. lépés: Futtasd — buknia kell**

```bash
mise exec -- pnpm vitest run src/rubric/language.test.ts
```

Várt: `Failed to resolve import "./language.js"`.

- [ ] **3. lépés: Írd meg a kaput**

`src/rubric/language.ts`:

```ts
import { identifyLanguage, LANGUAGE_NAMES } from '../lang/identify.js'
import type { Criterion, Score } from './types.js'

/**
 * Determinisztikus nyelvi ellenőrzés: a kimenet nyelve az **átirat**
 * nyelvéhez mérve. Sima függvény, nulla token.
 *
 * A viszonyítási alap azért az átirat, és nem az `item.language`, mert
 * pontosan ez az az invariáns, amit a prompt szabálya kimond — és mert
 * mindkét szöveg amúgy is a `ScoreContext`-ben van, tehát a `refine` loopot
 * nem kell hozzányúlni.
 *
 * **Bizonytalanságnál átenged.** Egy téves „ez más nyelv" ítélet egy helyes
 * jegyzetet buktatna meg, elköltené rá az összes javító kört, és
 * `item:failed`-del zárná — miközben a jegyzettel semmi baj. A kapu
 * biztonsági háló, nem az egyetlen ellenőrzés.
 */
export function checkLanguage(output: string, transcript: string): Score {
  const jegyzet = identifyLanguage(output)
  const forras = identifyLanguage(transcript)

  if (jegyzet === null || forras === null) return { value: 1, gaps: [] }
  if (jegyzet === forras) return { value: 1, gaps: [] }

  // A hiányüzenet angolul szól, mert visszamegy a modellnek a javító
  // promptban — a `format.ts` konvenciója szerint.
  return {
    value: 0,
    gaps: [
      `The output is written in ${LANGUAGE_NAMES[jegyzet]}, but the transcript is in ` +
        `${LANGUAGE_NAMES[forras]}. Rewrite it in ${LANGUAGE_NAMES[forras]}. Keep the ` +
        `same content; only the language must change.`,
    ],
  }
}

/** Kapu-kritérium: bukása esetén a bíró-hívások el sem indulnak. */
export const languageCriterion: Criterion = {
  name: 'language',
  blocking: true,
  score: (ctx) => Promise.resolve(checkLanguage(ctx.output, ctx.transcript)),
}
```

- [ ] **4. lépés: Futtasd, ellenőrizz, commitolj**

```bash
mise exec -- pnpm vitest run src/rubric/language.test.ts
mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint
git add src/rubric/language.ts src/rubric/language.test.ts
git commit -m "$(cat <<'EOF'
feat(rubric): blokkoló nyelvi kapu

- A kimenet nyelve az átirathoz mérve, nulla token
- Bizonytalanságnál átenged: a téves bukás drágább, mint a kihagyott fogás
- A hiány mindkét nyelvet megnevezi, angolul, mert a modellnek megy vissza
- A rossz nyelvű kimenet nulla bíró-hívásba kerül

Refs #18
EOF
)"
```

---

## Feladat 4: A promptok és a rubrikák bekötése

Ez a feladat a legszélesebb, de a legmechanikusabb: három recept ugyanazt a
két változást kapja.

**Fájlok:**
- Módosít: `src/recipe/rules.ts`, `src/recipe/rules.test.ts`
- Módosít: `src/recipe/summary.ts:16-37,87-92` és `summary.test.ts`
- Módosít: `src/recipe/qa.ts:11-31` és `qa.test.ts`
- Módosít: `src/recipe/flashcards.ts:147-167,219-229` és `flashcards.test.ts`

**Interfészek:**
- Fogyaszt: `languageName` (Feladat 2), `languageCriterion` (Feladat 3).
- Termel: `languageRule(item: SourceItem): string`. A `RULE.language`
  **megszűnik** — minden hivatkozása átáll.

- [ ] **1. lépés: A szabálymodul**

`src/recipe/rules.ts` — a `RULE` objektumból **töröld** a `language` tagot, és
a fájl elejére/végére vedd fel az új függvényt:

```ts
import { languageName } from '../lang/identify.js'
import type { SourceItem } from '../types.js'

/**
 * A vault-invariáns prompt-szabályok. Minden recept ugyanezeket idézi: a
 * visszavezethetőség és a vault írási szabályai nem recept-függőek.
 *
 * A recept-specifikus szabályt (hossz, szerkezet) mindegyik recept maga fűzi
 * hozzá, a **saját sorrendjében** — ezért nevesített konstansok, nem kész
 * lista.
 *
 * Angolul, mert a promptba mennek.
 */
export const RULE = {
  traceable: [
    '- Every statement must be traceable to the transcript. Do not add outside',
    '  knowledge, and do not speculate about what the speaker meant.',
  ].join('\n'),

  noFrontmatter: '- Do not emit YAML frontmatter; it is added separately.',

  noWikilinks: [
    '- Do not use wikilinks (`[[...]]`). If you link, wrap the target in angle',
    '  brackets: `[Name](<https://example.com>)`.',
  ].join('\n'),
} as const

/**
 * A nyelvi szabály **elemenként változik**, ezért függvény, nem konstans.
 *
 * A nyelvet kimondjuk, nem az átiratra hivatkozunk. A korábbi
 * megfogalmazás — „write in the same language as the transcript" — nem
 * bizonyult elég erősnek: a modell a prompt `Channel:` sorából a beszélő
 * nevére, abból pedig kimeneti nyelvre következtetett, és felülírta a
 * szabályt (`0009`). A `Channel:` sor azóta nincs a promptban, de a
 * kimondott nyelv attól függetlenül erősebb utasítás.
 */
export function languageRule(item: SourceItem): string {
  return `- Write in ${languageName(item.language)}. Do not translate the transcript into another language.`
}
```

- [ ] **2. lépés: A három recept — ugyanaz a három szerkesztés mindegyikben**

**(a)** A `const RULES = [...].join('\n')` konstansból **függvény** lesz. A
`summary.ts`-ben:

```ts
const rules = (item: SourceItem): string =>
  [
    languageRule(item),
    RULE.traceable,
    [
      '- Open with a short paragraph on what the video is about, then use `##`',
      '  sections with bullet points for the substance.',
    ].join('\n'),
    RULE.noFrontmatter,
    RULE.noWikilinks,
    "- Aim for roughly a tenth of the transcript's length.",
  ].join('\n')
```

A `qa.ts` és a `flashcards.ts` ugyanígy: a saját listájuk **változatlan
sorrendben**, csak a `RULE.language` helyére `languageRule(item)` kerül, és a
konstans függvénnyé válik.

**(b)** A `header(item)` függvényt és a doc-kommentjét **töröld** mindhárom
fájlból. A promptokban a `...header(item)` helyére egyetlen sor kerül:

```ts
      `Title: ${item.title}`,
```

**(c)** Az importok és a rubrika. Mindhárom fájlban:

```ts
import { languageRule, RULE } from './rules.js'
import { languageCriterion } from '../rubric/language.js'
```

A `prompt` és a `repairPrompt` törzsében `RULES` → `rules(item)`.

A rubrikákban a `languageCriterion` a formátumkapu(k) **után** áll:

```ts
// summary.ts és qa.ts
criteria: [formatCriterion, languageCriterion, faithfulnessCriterion, coverageCriterion],

// flashcards.ts
criteria: [
  formatCriterion,
  flashcardFormatCriterion,
  languageCriterion,
  faithfulnessCriterion,
  coverageCriterion,
],
```

- [ ] **3. lépés: A tesztek átírása**

`src/recipe/rules.test.ts`:

- Az `EXPECTED` horgony **első sora** cserélődik:

```ts
const EXPECTED = [
  '- Write in English. Do not translate the transcript into another language.',
  '- Every statement must be traceable to the transcript. Do not add outside',
  '  knowledge, and do not speculate about what the speaker meant.',
  '- Open with a short paragraph on what the video is about, then use `##`',
  '  sections with bullet points for the substance.',
  '- Do not emit YAML frontmatter; it is added separately.',
  '- Do not use wikilinks (`[[...]]`). If you link, wrap the target in angle',
  '  brackets: `[Name](<https://example.com>)`.',
  "- Aim for roughly a tenth of the transcript's length.",
].join('\n')
```

- A `RULE.language`-re hivatkozó állítás (`rules.test.ts:37`) átáll:

```ts
  it('a szabályok angolul szólnak, mert a promptba mennek', () => {
    expect(languageRule(ITEM)).toMatch(/do not translate/i)
    expect(RULE.noWikilinks).toMatch(/wikilink/i)
  })

  it('a megnevezett nyelv az elemtől függ, nem beégetett', () => {
    expect(languageRule({ ...ITEM, language: 'hu' })).toContain('Hungarian')
    expect(languageRule({ ...ITEM, language: null })).toContain('English')
  })
```

Az importot bővítsd: `import { languageRule, RULE } from './rules.js'`.

`src/recipe/summary.test.ts`:

- a kritériumnevek (`:35`): `['format', 'language', 'faithfulness', 'coverage']`
- a `toContain('Some Channel')` állítás (`:43`) **törlendő**, és a teszt neve
  „a promptba bekerül az átirat és a cím" lesz
- a `metaadat nélkül nem ír kitalált csatornát` teszt (`:79-82`) helyére a
  **valódi regressziós teszt** kerül — csatornanévvel a metaadatban:

```ts
  it('a prompt SOHA nem tartalmaz Channel: sort, metaadattal sem', () => {
    // Ez a hiba magja: a `Channel:` sorból a modell a beszélő nevére, abból
    // pedig kimeneti nyelvre következtetett. Kontrollált A/B igazolta, hogy
    // a sor eltávolítása megszünteti a sodródást (`0009`).
    const prompt = summaryRecipe.prompt(INPUT)
    expect(prompt).toContain('Title: Agent orchestration explained')
    expect(prompt).not.toContain('Channel:')
    expect(prompt).not.toContain('Some Channel')
  })
```

`src/recipe/qa.test.ts`: ugyanez a három szerkesztés. A kritériumnevek
`['format', 'language', 'faithfulness', 'coverage']`; a `toContain('Csatorna')`
törlendő; a záró teszt csatornás metaadattal állítja a `Channel:` hiányát.

> **Figyelem a `qa` esetében:** az `ITEM.sourceFile` értéke
> `'Csatorna/Cím.en.srt'`, de a `sourceFile` nem kerül a promptba. A
> `toContain('Csatorna')` állítás tehát a `Channel:` sor eltávolítása után
> **biztosan megbukik** — ez helyes, törölni kell, nem megkerülni.

`src/recipe/flashcards.test.ts`: a kritériumnevek
`['format', 'flashcards-format', 'language', 'faithfulness', 'coverage']`, és
a harmadik elem blokkoló:

```ts
    expect(flashcardsRecipe.rubric.criteria[2]!.blocking).toBe(true)
```

A `toContain('Csatorna')` törlendő; a záró teszt ugyanúgy csatornás
metaadattal állítja a `Channel:` hiányát.

- [ ] **4. lépés: Futtasd**

```bash
mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint
```

Várt: minden zöld. Ha egy recept-teszt még mindig `Csatorna`-t vagy
`Some Channel`-t vár, azt az állítást **törölni** kell, nem a promptot
visszaállítani.

- [ ] **5. lépés: Bizonyítsd, hogy a kapu tényleg be van kötve**

```bash
cp src/recipe/summary.ts /tmp/summary.bak
```

Mutáció: vedd ki a `languageCriterion`-t a `summary` rubrikájából. Futtasd:

```bash
mise exec -- pnpm vitest run src/recipe/summary.test.ts
```

Várt: a kritériumneveket állító teszt megbukik. Állítsd vissza:

```bash
cp /tmp/summary.bak src/recipe/summary.ts && diff -q /tmp/summary.bak src/recipe/summary.ts
```

- [ ] **6. lépés: Commit**

```bash
git add src/recipe/
git commit -m "$(cat <<'EOF'
fix(recipe): a Channel sor kikerül, a prompt kimondja a nyelvet

- A `Channel:` sor mindhárom receptből eltávolítva: kontrollált A/B
  igazolta, hogy a beszélő nevéből a modell kimeneti nyelvre következtet
- A `RULE.language` konstansból `languageRule(item)` függvény lett
- A nyelvi kapu mindhárom rubrikába bekötve, a formátumkapuk után
- A `Title:` sor marad; a maradék kockázatot a kapu fogja

Refs #18
EOF
)"
```

---

## Feladat 5: Az ADR és a dokumentáció

**Fájlok:**
- Létrehoz: `docs/decisions/0009-nyelvi-kapu.md`
- Módosít: `docs/architecture.md`, `docs/evaluation.md`

- [ ] **1. lépés: Az ADR**

Hozd létre a `docs/decisions/0009-nyelvi-kapu.md`-t **pontosan ezzel a
tartalommal**:

````markdown
# 0009 — A jegyzet nyelvét kimondjuk és ellenőrizzük

**Dátum:** 2026-09-10 · **Státusz:** elfogadva

## A kérdés

Egy angol átiratból holland jegyzet született. A prompt kimondta, hogy „write
in the same language as the transcript. Do not translate", és a modell mégis
fordított.

Kontrollált A/B — ugyanaz az angol átirat, ugyanazok a szabályok, ugyanaz a
modell, egyetlen változó a prompt `Channel:` sora:

| a prompt `Channel:` sora | a válasz nyelve |
|---|---|
| holland személynév | holland (kétszer) |
| `John Smith` | angol |
| nincs `Channel:` sor | angol (kétszer) |

A modell tehát a **beszélő nevéből** következtetett kimeneti nyelvre, és ez
felülírta mind az átirat nyelvét, mind a kifejezett tiltást.

Ráadásul semmi nem fogta meg: a rubrikában nem volt nyelvi kritérium, tehát a
holland jegyzet átment a formátumkapun, 1,00-t kapott a bírótól, és
publikálható lett.

Mi legyen a prompt szerződése a nyelvről, és mi őrizze?

## A döntés

**A `Channel:` sor kikerül a promptból, a jegyzet nyelvét kimondjuk, és egy
determinisztikus, blokkoló kapu ellenőrzi.**

Három rész, és mindhárom kell:

1. a `Channel:` sor eltávolítása mindhárom receptből — a bizonyított ok
2. `- Write in <Nyelv>. Do not translate the transcript into another language.`
   — a nyelv neve az `item.language` fájlnév-utótagból, hiányzó vagy ismeretlen
   tagnál **English**
3. `languageCriterion` — blokkoló kapu, ami a kimenet nyelvét az **átirat**
   nyelvéhez méri, funkciószó-profillal, nulla tokenből

## Mi döntötte el

**1. A tiltó megfogalmazás nem elég erős.** A „same language as the
transcript" arra kéri a modellt, hogy maga állapítsa meg a nyelvet — és épp ez
az, amiben megbízhatatlannak bizonyult. A kimondott nyelvnév nem hagy
következtetnivalót.

**2. A `Channel:` sor amúgy sem volt indokolt.** A csatornanév nincs benne az
átiratban, tehát már a bevezetése óta feszül a saját `traceable`
szabályunkkal („Do not add outside knowledge"), és egyetlen mérőszám sem
tulajdonított neki értéket. A `Title:` sor marad: az a jegyzet tárgya, és az
A/B-ben mellette is kétszer angol volt a válasz.

**3. A kapu bizonytalanságnál átenged, nem buktat.** A funkciószó-profil
`null`-t ad, ha a jel gyenge, és ilyenkor a kapu átengedi a jegyzetet. Egy
téves „ez más nyelv" ítélet ugyanis egy **helyes** jegyzetet buktatna meg,
elköltené rá az összes javító kört, és `item:failed`-del zárná. A kapu
biztonsági háló, nem az egyetlen ellenőrzés — ahol hallgat, a bíró-kritériumok
továbbra is pontoznak.

**4. A prompt a metaadatból veszi a nyelvet, nem a saját azonosítónkból.** A
kockázat aszimmetrikus. Ha az azonosítóból írnánk a promptot, és az téved,
**rossz nyelvet parancsolnánk** — a kapu pedig, ugyanazzal a tévedéssel, át is
engedné: néma hiba. Fordítva a tévedés csak zajos bukás, amit a napló
megmutat.

**5. A kapu az átirathoz mér, nem a metaadathoz.** Ez pontosan az az
invariáns, amit a szabály kimond, és metaadat nélküli elemen is működik. Az
`item.language` a fájlnév utótagja, ami `null` is lehet.

## Következmények

- A rubrika kapui **kétszintűek** lettek: formátum, majd nyelv. Mindkettő
  nulla token, tehát a rossz nyelvű kimenet nem kerül bíró-hívásba.
- A nyelvi hiány visszamegy a javító promptba, angolul, mindkét nyelvet
  megnevezve — egy szám nem tudna javítást vezérelni.
- **Ha egy nyelv nincs a profilban**, a kapu hallgat rá. Ez tudatos: a hét
  latin betűs nyelv fedi a mai korpuszt és a megfigyelt hibát. A bővítés
  akkor jön, ha egy valódi eset kéri.
- A `RULE.language` konstans megszűnt; helyette `languageRule(item)` függvény
  áll, mert a szabály elemenként változik.
````

- [ ] **2. lépés: A meglévő dokumentáció**

- `docs/architecture.md`: ahol a rubrika kapuit sorolja, vedd fel a nyelvi
  kaput. Ha a `Channel:` sor bárhol szerepel promptpéldában, javítsd.
- `docs/evaluation.md`: a determinisztikus kapukat leíró szakaszban vedd fel
  a nyelvi kaput, és hivatkozz a `0009`-re.

Előbb **keresd meg**, mit kell javítani:

```bash
grep -rn "Channel\|formatCriterion\|kapu" docs/architecture.md docs/evaluation.md
```

- [ ] **3. lépés: Ellenőrzés és commit**

```bash
mise exec -- pnpm test && mise exec -- pnpm typecheck && mise exec -- pnpm lint
git add docs/
git commit -m "$(cat <<'EOF'
docs: a nyelvi kapu döntése és a hozzá tartozó dokumentáció

- `0009` rögzíti a `Channel:` sor eltávolítását és a blokkoló kaput
- Az architektúra és az értékelés leírása követi az új kaput

Refs #18
EOF
)"
```

---

## Feladat 6: A füstpróba

> **ÁLLJ MEG, ÉS KÉRJ MEGERŐSÍTÉST.** Ez a feladat **valódi pénzt költ**, és
> valódi modellhívásokat végez. Ne indítsd el a felhasználó jóváhagyása
> nélkül.

**Miért kell.** A Feladat 1 tesztje azt bizonyítja, hogy `json_schema`-t
**küldünk** — azt nem, hogy a LiteLLM és a `claude-sonnet-5` `strict: true`
mellett **elfogadja**. A mért kéréstörzs:

```json
{"type":"json_schema","json_schema":{"schema":{"$schema":"http://json-schema.org/draft-07/schema#",
"type":"object","properties":{"answer":{"type":"string"}},"required":["answer"],
"additionalProperties":false},"strict":true,"name":"response"}}
```

A `strict: true` és az `additionalProperties: false` az, amit a gatewaynek át
kell engednie. Pontosan ez az a fajta állítás, amit a fake-ek eddig elrejtettek.

- [ ] **1. lépés: Egy `summary` elem, éles úton**

```bash
mise exec -- pnpm tsx src/cli.ts run --recipe summary --limit 1 --dry-run
```

A `--dry-run` nem ír fájlt és nem rögzít állapotot, de a **modellhívások
valóban megtörténnek**, valós költséggel. Jegyezd fel a kiírt pontszámot és a
generálások számát.

- [ ] **2. lépés: Egy `flashcards` elem, éles úton**

```bash
mise exec -- pnpm tsx src/cli.ts run --recipe flashcards --limit 1 --dry-run
```

Ez a döntő próba. Két kimenetel lehet:

- **átmegy** → a séma tényleg kimegy és a gateway elfogadja; az 1. hiba javítva
- **`a modell nem a sémának megfelelő kimenetet adott: ...`** → a `strict`
  módot a gateway nem engedi át. **Ne javítgasd találomra**: írd le a pontos
  hibaüzenetet, és jelezd. A következő lépés a `strictJsonSchema: false`
  providerOption vizsgálata lenne, de az önálló döntés.

- [ ] **3. lépés: A nyelvi javítás ellenőrzése azon az elemen, ami hollandul jött**

A pilótán egy holland nevű csatorna elemére érkezett holland válasz. Futtasd
azt az elemet:

```bash
mise exec -- pnpm tsx src/cli.ts run --recipe summary --channel "<a csatorna neve>" --limit 1 --dry-run
```

Várt: a futás **nem** ír nyelvi hiányt, és a pontszám nem nulla. Ha a kapu
nyelvi hiánnyal buktat, a prompt javítása nem elég erős — írd le, és jelezd.

> **A csatorna nevét ne írd bele semmilyen commitolt fájlba.** A riportba és a
> PR leírásába „holland nevű csatorna" megy, név nélkül.

- [ ] **4. lépés: Az eredmény rögzítése**

A három futás eredményét — a tényleges költséget is — írd bele a PR
leírásába. **Bukás esetén is.** A szelet nem attól kész, hogy a füstpróba
sikerült, hanem attól, hogy tudjuk, mi történt.

- [ ] **5. lépés: A branch lezárása**

KÖTELEZŐ AL-SKILL: `superpowers:finishing-a-development-branch`.

A PR lábléce `Closes #18`, mert ez a szelet zárja le a három hibát.

---

## Ami ebbe a tervbe szándékosan nem fér bele

- **A `warnings` mező vezetékezése.** A Feladat 1 regressziós tesztje ezt a
  hibát véglegesen megfogja; az általános háló kiszélesítené a szándékosan
  szűk `ModelClient` felületet.
- **A `maxIterations` értéke.** Az a mérés döntése (`#16`), és a mérés ezen az
  ágon még nem futott le.
- **A `keyPoints` mező.** A `ScoreContext:21` deklarálja, de egyetlen hívási
  hely sem tölti — halott képesség, önálló kérdés.
- **A `Title:` sor nyelvi hatásának mérése.** A sor marad; ha kiderül, hogy az
  is sodor, az következő, mérésre alapozott döntés.
