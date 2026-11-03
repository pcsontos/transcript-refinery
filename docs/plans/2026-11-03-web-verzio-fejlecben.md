# A verziószám a web fejlécében — implementációs terv (#357)

> **Végrehajtóknak:** ennél a felhasználónál a terv **natívan**, skill és alügynök nélkül fut a munkamenetben (Read/Edit/Bash). A záró, teljes ágra szóló review Opuson. A lépések `- [ ]` jelölésűek.

**Cél:** a web fejlécében a „Transcript Refinery” cím mellett `v{verzió}` látszik, a `web/package.json`-ból.

**Felépítés:** a `web/nuxt.config.ts` build idején beolvassa a `web/package.json` `version` mezőjét, és a `runtimeConfig.public.appVersion`-be teszi. A `web/app/layouts/default.vue` a `useRuntimeConfig()`-ból kiírja. A mag (`src/`) nem változik.

**Technológia:** Nuxt 4, Nuxt UI, `@nuxt/test-utils/e2e`, vitest.

**Spec:** [2026-11-03-web-verzio-fejlecben-spec.md](2026-11-03-web-verzio-fejlecben-spec.md)

## Globális megkötések

- Formátum: `v` + a `web/package.json` `version` mezője, például `v1.29.0`. Commit-azonosító nincs.
- A kulcs: `runtimeConfig.public.appVersion`.
- Nincs új API-végpont, és nincs `src/` változás.
- Minden feladat után zöld: `pnpm web:typecheck && pnpm web:lint && pnpm web:test`.
- Commit-üzenet a `commit-message` skill-lel; ág: a felhasználó adja.

## Review-fókusz

1. **Puszta számra keresés a tesztben** → a Nuxt az `appVersion`-t `v` nélkül a beágyazott payloadba is beírja, így a teszt akkor is zöld lenne, ha a fejléc üres. A teszt a `v` előtagos alakot keresi, ezért fejléc nélkül bukik. Teszt: 1. feladat, a mutációs lépés igazolja.
2. **Beégetett szám a tesztben** → a következő `bumpp` után bukna. A teszt a `web/package.json`-ból olvas. Teszt: 1. feladat.
3. **Nem a fejlécben jelenik meg, hanem máshol az oldalon** → a teszt a `<header>` elem tartalmát nézi, nem a teljes HTML-t. Teszt: 1. feladat.
4. **A verzió a kliensoldali hidratálás után eltűnik vagy villog** → `runtimeConfig.public` mindkét oldalon ugyanaz, így ez nem várható. Csak a kézi próba nézi (2. lépéssor).
5. **`NUXT_PUBLIC_APP_VERSION` felülírja** → a spec elfogadott kockázata, nincs rá teszt.

---

### 1. feladat: Verzió a fejlécben

**Fájlok:**
- Módosít: `web/nuxt.config.ts` (`runtimeConfig`)
- Módosít: `web/app/layouts/default.vue` (a `<header>` `UContainer`-e)
- Teszt: `web/test/e2e/api.test.ts` (a meglévő egyetlen `describe('API')` blokkba)

**Interfészek:**
- Termel: `useRuntimeConfig().public.appVersion: string`

- [ ] **1. lépés: A bukó teszt**

A fájl tetején a verzió beolvasása a `web/package.json`-ból (`readFileSync` és `new URL('../../package.json', import.meta.url)`). A teszt a `describe('API')` blokk végére kerül:

```ts
it('a fejlécben a cím mellett a web verziója látszik', async () => {
  const html = await $fetch<string>('/')
  const header = html.match(/<header[\s\S]*?<\/header>/)?.[0] ?? ''
  expect(header).toContain('Transcript Refinery')
  expect(header).toContain(`v${webVersion}`)
})
```

- [ ] **2. lépés: Futtatás, bukás**

Futtatás: `pnpm web:test`
Várt: az új teszt FAIL, mert a `header` nem tartalmazza a `v1.29.0`-t. A többi teszt zöld.

- [ ] **3. lépés: A megvalósítás**

- `web/nuxt.config.ts`: a `web/package.json` beolvasása `readFileSync`-kel, a `repoRoot` mintájára `new URL('package.json', import.meta.url)` úttal. A `runtimeConfig` legyen `{ refineryRoot: repoRoot, public: { appVersion: version } }`. Egy sor magyar megjegyzés: a web az image-ben épül, ezért a build idején beolvasott szám a futó image verziója.
- `web/app/layouts/default.vue`: a `<script setup>`-ban `const { appVersion } = useRuntimeConfig().public`. A cím `<span>`-ja után, a menü előtt: `<span class="text-sm text-muted">v{{ appVersion }}</span>`. Ha a `gap-6` túl nagy köz a cím és a szám között, a kettő kerüljön közös `<span class="flex items-baseline gap-2">`-be.

- [ ] **4. lépés: Futtatás, zöld**

Futtatás: `pnpm web:typecheck && pnpm web:lint && pnpm web:test`
Várt: minden zöld, az új teszttel együtt.

- [ ] **5. lépés: Mutációs próba**

A `default.vue`-ban ideiglenesen töröld a `v` előtagot (`{{ appVersion }}`), és futtasd a `pnpm web:test`-et. Várt: az új teszt FAIL. Utána állítsd vissza, és futtasd újra: zöld. Ezzel igazolod, hogy a teszt nem a payloadban lévő puszta számtól zöld.

- [ ] **6. lépés: Kézi próba helyben**

Futtatás: `pnpm web:dev`, majd a böngészőben a `http://localhost:4310` címen. A Chrome-bővítmény `localhost`-on működik, `127.0.0.1`-en nem.
Várt: a cím mellett halványan a `v1.29.0` felirat látszik, a menü előtt, és újratöltéskor sem villog.

- [ ] **7. lépés: Commit**

```bash
git add web/nuxt.config.ts web/app/layouts/default.vue web/test/e2e/api.test.ts
```

Az üzenet a `commit-message` skill-lel készül, a lábléc `Refs #357`.

## A terv után

- Kód-PR, CI (`gh pr checks`), merge, kiadás a szokott menettel (bumpp + changelog, tag, `pnpm docker:publish`, mert a konténer kódja változik).
- Élő próba a peter-mba-n: a web fejlécében ugyanaz a szám látszik, mint a `https://refinery-mba.peteroncode.dev/version` válaszában.
