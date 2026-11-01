# Telegram-link a site-ra és nem hu/en eredeti nyelvű deploy — implementációs terv

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Telegram „kész" linkje a site-on nyissa meg a jegyzetet (#279), és a `refinery deploy` a nem hu/en eredeti nyelvű jegyzeteket is kivigye (#334).

**Architecture:** A Worker egy új `SITE_URL` változóból építi a jegyzetlinket (`runReadyMessage`, egyetlen helyen); a `/link?t=…` a Worker originjén marad. A deploy nyelvi szabálya a site szabályának átirata: eredetinél a site ISO 639-1 listája, fordításnál `hu`/`en`; az eredeti nélküli fordítás kimarad, hogy a site buildje ne bukjon el.

**Tech Stack:** TypeScript, Cloudflare Workers (wrangler), Node CLI, vitest.

**Spec:** `docs/plans/2026-11-01-site-link-nyelvek-spec.md`

## Global Constraints

- Ponytail: a legrövidebb működő diff; új fájl nincs (a kódlista a `src/deploy/variant.ts`-be kerül, a `mdx.ts` onnan importál); új függőség nincs.
- `SITE_URL` éles értéke: `https://transcripts.peteroncode.dev`; üres vagy hiányzó érték = nincs `SITE_URL` (mai linkek).
- Site-link alapreceptre: `<SITE_URL>/notes/<itemId>/<recept>` (nyelv nélkül).
- Site-link `hu`/`en` fordításra: `<SITE_URL>/<nyelv>/notes/<itemId>/<recept>` (a recept a `-<nyelv>` végződés nélkül).
- Más célnyelvű fordításra (`nl`, `de`, `es`, `fr`, `it`): a mai Worker-link (`<linkBase>/notes/<itemId>/<recept>-<nyelv>`).
- A `/link?t=…` mindig a `linkBase`-en (Worker origin).
- Eredeti változat nyelve: a site 183 kódos ISO 639-1 listája (showroom `lib/note-frontmatter.ts:7-20`, betűre átmásolva). Fordítás nyelve: `hu` vagy `en`.
- Az árva fordítás kihagyásának oka szó szerint: `nincs eredeti változat a site-on`.
- Callout-címek: `hu: 'Röviden'`, `en: 'In brief'`, `nl: 'Kort gezegd'`, `de: 'Kurz gesagt'`, `es: 'En resumen'`, `fr: 'En bref'`, `it: 'In breve'`; minden más kódra `'In brief'`.
- Minden feladat után: `pnpm typecheck`, `npx tsc -p worker/tsconfig.json --noEmit`, `pnpm lint`, `pnpm test` zöld.
- Commit-üzenet a `commit-message` skill-lel.

## Review Focus

1. **Fordítás a `done`-ágon** (`handle.ts:605`, leállt futás kész részei): a `body.done` elemei `<recept>-<nyelv>` alakúak (`src/serve/summary.ts:154`) — a `hu`/`en` fordítás site-linkje itt is a végződés nélküli receptre mutasson. → teszt az 1. feladatban.
2. **Záró `/` a `SITE_URL`-ben** (`https://site.test/`): nem lehet `//notes`. → teszt az 1. feladatban.
3. **Szűrt deploy (`--kind summary`) árva fordítással:** a kihagyás oka akkor is látszódjon, a szűrőn kívüli fajtáé ne. → teszt a 3. feladatban.
4. **Glossary nem hu/en eredetivel** (`glossary-nl`): eredetiként kezelődik (nincs `translation_of`), kimegy `glossary.nl.mdx`-ként. → teszt a 2. feladatban.
5. **Meglévő, csak fordítást tartalmazó deploy-tesztek:** az árva-szabály miatt eltörhetnek; ilyenkor a teszt kapja meg az eredetit, a viselkedés nem lazul. → a 3. feladat 4. lépése.

---

### Task 1: Worker — jegyzetlink a site-ra (`SITE_URL`)

**Files:**
- Modify: `worker/src/plan.ts:168-180` (`runReadyMessage`, új `noteLink`)
- Modify: `worker/src/handle.ts:96` (`WorkerDeps.siteUrl`), `:589`, `:605`, `:631`, `:699` (hívók)
- Modify: `worker/src/index.ts:15-23` (`Env.SITE_URL?`), `:78-82` (`deps`)
- Modify: `worker/wrangler.toml` (új `[vars]`)
- Modify: `scripts/telegram-debug.sh:164-171` (üres `SITE_URL`)
- Modify: `docs/operations/telegram-worker-topology.md:57-65` (konfigurációs tábla)
- Test: `worker/src/plan.test.ts`, `worker/src/handle.test.ts`

**Interfaces:**
- Produces: `export function noteLink(run: Pick<RunRow, 'jobId' | 'lang'>, kind: string, linkBase: string, siteUrl: string): string` a `plan.ts`-ben.
- Produces: `runReadyMessage(title: string, run: Pick<RunRow, 'jobId' | 'recipes' | 'lang'>, linkBase: string, siteUrl: string, kinds?: readonly string[]): string` — a `siteUrl` a `linkBase` után, a `kinds` előtt.
- Produces: `WorkerDeps.siteUrl: string`.

- [ ] **Step 0: Cloudflare dashboard ellenőrzése (kézi, a felhasználó)**

A fájlbeli `[vars]` deploykor lecseréli a dashboardon kézzel állított sima változókat. Cloudflare → Workers → `transcript-refinery` → Settings → Variables and Secrets: csak **Secret** típusú sorok legyenek. Ha van sima (Plaintext) változó, az is kerüljön a `[vars]`-ba, különben a deploy törli. Eredmény a PR-leírásba.

- [x] **Step 1: Failing tesztek a `plan.test.ts`-ben**

A meglévő `runReadyMessage`-hívások (`:151`, `:298`, `:301`) kapnak egy `''` negyedik argumentumot (a mai linkek maradnak). Új teszt:

```ts
it('a SITE_URL-lel az alaprecept nyelv nélküli, a hu/en fordítás nyelvi site-link, a többi Worker-link', () => {
  const site = 'https://site.test'
  expect(runReadyMessage('Cím', run({ recipes: ['notes'] }), 'https://w.test', site)).toBe(
    `Cím · notes. A jegyzet megvan.\nhttps://site.test/notes/${ID}/notes`,
  )
  expect(runReadyMessage('Cím', run({ recipes: ['summary', 'qa'], lang: 'en' }), 'https://w.test', site)).toBe(
    `Cím · en. A fordítás megvan.\nhttps://site.test/en/notes/${ID}/summary\nhttps://site.test/en/notes/${ID}/qa`,
  )
  expect(runReadyMessage('Cím', run({ recipes: ['summary'], lang: 'hu' }), 'https://w.test', site)).toBe(
    `Cím · hu. A fordítás megvan.\nhttps://site.test/hu/notes/${ID}/summary`,
  )
  expect(runReadyMessage('Cím', run({ recipes: ['summary'], lang: 'de' }), 'https://w.test', site)).toBe(
    `Cím · de. A fordítás megvan.\nhttps://w.test/notes/${ID}/summary-de`,
  )
  expect(runReadyMessage('Cím', run({ recipes: ['notes'] }), 'https://w.test', 'https://site.test/')).toBe(
    `Cím · notes. A jegyzet megvan.\nhttps://site.test/notes/${ID}/notes`,
  )
  // done-ág: a kész részek fajtanevei <recept>-<nyelv> alakúak
  expect(runReadyMessage('Cím', run({ recipes: ['summary', 'qa'], lang: 'en' }), 'https://w.test', site, ['summary-en'])).toBe(
    `Cím · en. A fordítás megvan.\nhttps://site.test/en/notes/${ID}/summary`,
  )
})
```

- [x] **Step 2: Futtatás, bukik**

Run: `pnpm vitest run worker/src/plan.test.ts`
Expected: FAIL (a site-linkes elvárások; a régi hívások a plusz `''`-vel még zöldek lehetnek).

- [x] **Step 3: `noteLink` és az új `runReadyMessage`-szignatúra a `plan.ts`-ben**

```ts
const SITE_TRANSLATIONS = ['hu', 'en']

/** A jegyzet linkje: `siteUrl`-lel a site-ra (alaprecept nyelv nélkül, hu/en fordítás nyelvvel), különben a Workerre. */
export function noteLink(run: Pick<RunRow, 'jobId' | 'lang'>, kind: string, linkBase: string, siteUrl: string): string {
  const id = videoIdOf(run.jobId)
  const site = siteUrl.replace(/\/+$/, '')
  if (site === '' || (run.lang !== null && !SITE_TRANSLATIONS.includes(run.lang))) return `${linkBase}/notes/${id}/${kind}`
  if (run.lang === null) return `${site}/notes/${id}/${kind}`
  return `${site}/${run.lang}/notes/${id}/${kind.slice(0, -(run.lang.length + 1))}`
}
```

A `runReadyMessage` törzsében a link `noteLink(run, kind, linkBase, siteUrl)`.

- [x] **Step 4: `WorkerDeps.siteUrl`, a négy hívó és az `index.ts`**

- `handle.ts`: `WorkerDeps`-be `siteUrl: string`; a négy `runReadyMessage(…, deps.linkBase, …)` hívás `deps.linkBase, deps.siteUrl`-t ad át (a `:605`-ös a `body.done`-t ötödiknek).
- `index.ts`: `Env`-be `SITE_URL?: string`; a `deps()` visszaadott objektumába `siteUrl: env.SITE_URL ?? ''`.
- `handle.test.ts`: a `deps()` gyár (`:57`) alapértéke `siteUrl: ''`.

- [x] **Step 5: Failing tesztek a `handle.test.ts`-ben**

- A `/start` teszt (`:663` körül) mintájára: `deps(store, { siteUrl: 'https://site.test' })` mellett a küldött sor továbbra is `https://worker.test/link?t=${TOKEN_A}`.
- A `:378`-as kész-visszahívás teszt mintájára: `siteUrl: 'https://site.test'` mellett a küldött üzenet `Cím · notes. A jegyzet megvan.\nhttps://site.test/notes/${ID}/notes`.

- [x] **Step 6: Futtatás, zöld**

Run: `pnpm vitest run worker/src/plan.test.ts worker/src/handle.test.ts && npx tsc -p worker/tsconfig.json --noEmit`
Expected: PASS, típushiba nincs.

- [x] **Step 7: Konfiguráció és doksi**

- `worker/wrangler.toml` végére:
  ```toml
  [vars]
  SITE_URL = "https://transcripts.peteroncode.dev"
  ```
  (plusz a 0. lépésben talált sima változók, ha vannak).
- `scripts/telegram-debug.sh`: a `.dev.vars`-blokkba `printf 'SITE_URL=\n'` (a helyben készült jegyzet nem kerül a site-ra).
- `docs/operations/telegram-worker-topology.md` táblájába sor: **Jegyzetlink alapja (`SITE_URL`)** | `worker/wrangler.toml` `[vars]` | `https://transcripts.peteroncode.dev`; alaprecept nyelv nélkül (a site a böngésző nyelvére irányít), `hu`/`en` fordítás a nyelvi úton, más célnyelv és üres érték a Worker `/notes` linkje; a `/link` mindig a Workeren.

- [x] **Step 8: Teljes ellenőrzés és commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS. Commit a `commit-message` skill-lel (`feat(worker): …`).

---

### Task 2: Deploy — nem hu/en eredeti nyelv

**Files:**
- Modify: `src/deploy/variant.ts:3`, `:44-47` (nyelvi szabály, kódlista)
- Modify: `src/deploy/mdx.ts:90-113` (`frontmatterError` nyelvi ága)
- Modify: `src/deploy/llm.ts:8`, `:25`, `:31-33`, `:66`, `:73-74`, `:135`, `:146` (nyelvnév, Callout-cím)
- Modify: `src/deploy/deploy.ts:23`, `:103` (`SiteLanguage` → `string`)
- Modify: `docs/usage.md:355`, `docs/plans/2026-10-24-refinery-deploy-spec.md:48`, `:135`
- Test: `src/deploy/variant.test.ts`, `src/deploy/mdx.test.ts`, `src/deploy/llm.test.ts`

**Interfaces:**
- Produces: `export const ISO_639_1: ReadonlySet<string>` és `export const TRANSLATION_LANGUAGES: readonly string[]` (`['hu', 'en']`) a `variant.ts`-ben; a `mdx.ts` ezeket importálja (a saját `LANGUAGES`-e törlődik).
- Produces: a `SiteLanguage` típus törlődik; ahol állt, `string`.

- [ ] **Step 1: Failing tesztek**

`variant.test.ts` — a „de eredeti kimarad" teszt helyére:

```ts
it('listás nyelvű eredeti kimegy, a listán kívüli és a hiányzó kimarad', () => {
  expect(variantOf('X', { vaultKind: 'summary', fields: { ...BASE, language: 'nl-orig' } }, NONE, null)).toMatchObject({
    ok: true, target: 'X/summary.nl.mdx', language: 'nl',
  })
  expect(variantOf('X', { vaultKind: 'summary', fields: { ...BASE, language: 'xx' } }, NONE, null)).toEqual({ ok: false, reason: 'nyelv: xx' })
  const { language: _l, ...nincs } = BASE
  expect(variantOf('X', { vaultKind: 'summary', fields: nincs }, NONE, null)).toEqual({ ok: false, reason: 'nyelv: ismeretlen' })
})

it('nem hu/en fordítás kimarad, nem hu/en szójegyzék eredetiként kimegy', () => {
  const tr = { ...BASE, language: 'de', translation_of: 'summary', source_language: 'hu', source_generated_at: 'T1' }
  expect(variantOf('X', { vaultKind: 'summary-de', fields: tr }, NONE, null)).toEqual({ ok: false, reason: 'nyelv: de' })
  const siblings = new Map([['summary', { source: 'youtube' }]])
  expect(variantOf('X', { vaultKind: 'glossary-nl', fields: { ...BASE, language: 'nl' } }, siblings, 'T2')).toMatchObject({
    ok: true, target: 'X/glossary.nl.mdx',
  })
})
```

`mdx.test.ts` — a `frontmatterError` „a site szabályait érvényesíti" tesztjében a `summary.de.mdx` sor helyére:

```ts
expect(frontmatterError('X/summary.nl.mdx', { ...FIELDS, language: 'nl' })).toBeNull()
expect(frontmatterError('X/summary.xx.mdx', { ...FIELDS, language: 'xx' })).toMatch(/ISO 639-1/)
expect(frontmatterError('X/summary.nl.mdx', { ...TR, language: 'nl' })).toMatch(/fordítás nyelvi suffixe/)
```

`llm.test.ts` — a „bevezető címszavát nyelv szerint kéri" tesztbe:

```ts
expect(mdxPrompt({ ...base, language: 'nl' })).toContain('title="Kort gezegd"')
expect(mdxPrompt({ ...base, language: 'nl' })).toContain('introduction in Dutch')
expect(mdxPrompt({ ...base, language: 'pt' })).toContain('title="In brief"')
```

(a `base`-ben a `language: 'hu' as const` → `language: 'hu'`).

- [ ] **Step 2: Futtatás, bukik**

Run: `pnpm vitest run src/deploy/variant.test.ts src/deploy/mdx.test.ts src/deploy/llm.test.ts`
Expected: FAIL a fenti elvárásokon.

- [ ] **Step 3: Nyelvi szabály**

- `variant.ts`: `ISO_639_1` a showroom `lib/note-frontmatter.ts:7-20` listájának betű szerinti másolata, fölötte egysoros megjegyzés a forrással (a `mdx.ts:90` „átirata" mintájára). A `variantOf` feltétele: `fields.translation_of !== undefined ? TRANSLATION_LANGUAGES.includes(lang) : ISO_639_1.has(lang)`; a kihagyási ok változatlan (`nyelv: …`).
- `mdx.ts` `frontmatterError`: a site szövegeivel (`lib/note-frontmatter.ts:31-36`): fordításnál `${target}: a fordítás nyelvi suffixe (${language}) csak hu vagy en lehet`, eredetinél `${target}: az eredeti változat nyelvi suffixe (${language}) nem kétbetűs, kisbetűs ISO 639-1 kód`.
- `llm.ts`: a `LANGUAGE_NAMES` helyett `new Intl.DisplayNames(['en'], { type: 'language' }).of(language)`; az `INTRO_TITLES` `Record<string, string>` a Global Constraints hét értékével, a két felhasználási helyen `INTRO_TITLES[language] ?? 'In brief'`.
- `SiteLanguage` törlése, a négy helyen `string`.

- [ ] **Step 4: Futtatás, zöld**

Run: `pnpm vitest run src/deploy && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Doksi**

- `docs/usage.md:355`: „a nem `hu`/`en` nyelvűt" → „a site listáján (ISO 639-1) kívüli vagy hiányzó nyelvűt, a nem `hu`/`en` célnyelvű fordítást".
- deploy-spec `:48` és `:135`: a nyelvi kihagyás csak a listán kívüli / hiányzó eredeti nyelvre és a nem `hu`/`en` fordításra vonatkozik (#334); a `:135` „nem hu/en eredeti (showroom #11)" pont törlődik.

- [ ] **Step 6: Teljes ellenőrzés és commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS. Commit (`feat(deploy): …`).

---

### Task 3: Deploy — árva fordítás kihagyása

**Files:**
- Modify: `src/deploy/deploy.ts:246-249` (a jelöltgyűjtő ciklus után, az `ordered` előtt)
- Test: `src/deploy/deploy.test.ts`

**Interfaces:**
- Consumes: a 2. feladat nyelvi szabálya (`xx` eredeti → kihagyás).

- [ ] **Step 1: Failing tesztek a `deploy.test.ts`-ben**

```ts
it('az eredeti nélküli fordítás kimarad, a napló megnevezi', async () => {
  const orig = await note('vid1', 'summary', { ...BASE, language: 'xx' })
  const tr = await note('vid1', 'summary-hu', {
    ...BASE, language: 'hu', translation_of: 'summary', source_language: 'xx', source_generated_at: 'T1',
  })
  const report = await deployNotes({ cfg })
  expect(report.skipped).toEqual(
    expect.arrayContaining([
      { path: orig, reason: 'nyelv: xx' },
      { path: tr, reason: 'nincs eredeti változat a site-on' },
    ]),
  )
  expect(await remoteHas('content/notes/vid1/summary.hu.mdx')).toBe(false)
})

it('szűrt futásban az árva fordítás oka csak a szűrt fajtánál látszik', async () => {
  await note('vid1', 'summary', { ...BASE, language: 'xx' })
  const tr = await note('vid1', 'summary-hu', {
    ...BASE, language: 'hu', translation_of: 'summary', source_language: 'xx', source_generated_at: 'T1',
  })
  await note('vid1', 'qa-hu', { ...BASE, language: 'hu', translation_of: 'qa', source_language: 'xx', source_generated_at: 'T1' })
  const report = await deployNotes({ cfg, filter: { items: ['vid1'], kinds: ['summary'] } })
  expect(report.skipped).toContainEqual({ path: tr, reason: 'nincs eredeti változat a site-on' })
  expect(report.skipped.some((s) => s.path.endsWith('vid1_qa-hu.md'))).toBe(false)
})
```

(Ha a `DeployFilter` mezőnevei mások, a `deploy.ts:52` szerint kell igazítani; a viselkedés a lényeg.)

- [ ] **Step 2: Futtatás, bukik**

Run: `pnpm vitest run src/deploy/deploy.test.ts`
Expected: FAIL (a fordítás kimegy, nincs ilyen ok).

- [ ] **Step 3: Szűrés a `deploy.ts`-ben**

A jelöltgyűjtő `for` ciklus után, az `ordered` előtt: azoknak a fajtáknak a halmaza, amelyeknek van eredeti jelöltje (`c.original`); a többi fajtájú, nem eredeti jelölt törlődik a `candidates`-ből, és ha `kindMatches(c.siteKind)`, a `report.skipped`-be kerül a fenti okkal. A szárazfutás ugyanezt a ciklust használja (`deploy.ts:265`), külön ág nem kell.

- [ ] **Step 4: Futtatás, zöld; meglévő tesztek**

Run: `pnpm vitest run src/deploy`
Expected: PASS. Ha egy meglévő teszt csak fordítást deployol eredeti nélkül, a teszt kapja meg az eredetit (`note(…, 'summary', BASE)`); a szabály nem lazul (Review Focus 5).

- [ ] **Step 5: Teljes ellenőrzés és commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS. Commit (`fix(deploy): …`).

---

## Kiadás utáni élő próba (a felhasználóval, nem a kód-ág része)

1. A serve-kép (2–3. feladat) és a Worker (1. feladat) telepítése; sorrend kötetlen.
2. Telegram: egy alaprecept „kész" linkje a deploy után a site-on nyílik meg; egy `en` fordításé az `/en/…` változaton.
3. Egy holland eredetijű jegyzet `refinery deploy --item <id>`-val: a site buildje zöld, a `/hu` és az `/en` a holland szöveget mutatja jelzéssel.
4. #195: döntés a lezárásról.
