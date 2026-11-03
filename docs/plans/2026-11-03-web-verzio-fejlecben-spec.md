Spec — A verziószám a web fejlécében (#357)

**Dátum:** 2026-11-03 · **Státusz:** tervezet

Ez a dokumentum a #357 brainstormingjából készült (2026-11-03).

## A cél egy mondatban

A refinery web fejlécében a „Transcript Refinery” cím mellett látszódjon a futó verzió (pl. `v1.29.0`), hogy frissítés után ránézésre kiderüljön, a `refinery-web` konténer tényleg az új image-en fut-e.

## Miért

- A peter-mba-n a web külön konténerben fut (`refinery-web`), ugyanabból az image-ből, mint a `serve`. Ma a verziót csak a `serve`-ről lehet megtudni (`https://refinery-mba.peteroncode.dev/version`, Telegram `/version`), a webről nem.
- **A felhasználó használata:** frissítés után ránéz a fejlécre (felhasználói megerősítés, 2026-11-03).

## Anti-cél

- **A felirat nem a futó image verzióját mutatja**, hanem például egy fejlesztői gépét vagy egy beégetett, kézzel írt számot. Ilyenkor a kijelzés pont azt a hibát fedi el, amit észre kellene venni.

## Nem cél

- Commit-azonosító vagy más build-adat a szám mellett (felhasználói döntés: „elég a szám”).
- Külön `/version` API-végpont a webhez.
- A mag (`src/`) változtatása, a `VERSION` exportja az `src/index.ts`-ből.
- Kattintható felirat, link a changelogra.

## Előfeltétel-tények (ellenőrizve a kódban, 2026-11-03)

- **A fejléc:** `web/app/layouts/default.vue`. A `<header>`-ben egy `UContainer`, benne a `<span class="font-semibold">Transcript Refinery</span>` és az `UNavigationMenu`.
- **A web verziója:** `web/package.json` `"version": "1.29.0"`, megegyezik a gyökér `package.json`-nal. A `bumpp` mindkettőt emeli (#349, lásd a kiadási menetet).
- **A web az image-ben épül:** a `Dockerfile` 7. sora `pnpm --filter transcript-refinery-web build`, a 27. sora a `web/.output`-ot másolja a végső image-be. A build idején beolvasott verzió tehát az image verziója, nem egy fejlesztői gépé.
- **A Nuxt-konfig:** `web/nuxt.config.ts`-ben ma `runtimeConfig: { refineryRoot: repoRoot }`, `public` rész nincs.
- **SSR be van kapcsolva** (nincs `ssr: false`), így a felirat a szerveren renderelt HTML-ben is benne van.
- **E2E-teszt:** `web/test/e2e/api.test.ts`, `@nuxt/test-utils/e2e` `setup()` és `$fetch`, egyetlen `describe` blokk a fájlban.

## A tervezés során hozott döntések

| kérdés | döntés | ki döntött |
|---|---|---|
| Mire jó | Frissítés után ránézés a fejlécre | felhasználó |
| Commit is kell-e | Nem, elég a szám | felhasználó |
| A verzió forrása | A `web/package.json` verziója, build idején beolvasva. Indok: a web az image-ben épül, és a `bumpp` a gyökérrel együtt emeli | javaslat, a felhasználó jóváhagyta |
| Kinézet | Kis, halvány szöveg a cím mellett, a menü előtt; formátum: `v` + verzió | javaslat, a felhasználó jóváhagyta |

## A változás

- A `web/nuxt.config.ts` a build idején beolvassa a `web/package.json` `version` mezőjét, és a `runtimeConfig.public`-ba teszi (pl. `appVersion`).
- A `web/app/layouts/default.vue` a cím mellett kiírja `v{verzió}` formában, halvány, kisebb betűvel (Nuxt UI `text-muted`/`text-sm` jellegű osztályokkal).

## Kockázatok és ismert korlátok

- **A `runtimeConfig.public` felülírható környezeti változóval** (`NUXT_PUBLIC_APP_VERSION`). Ha valaki a konténerben beállítja, a felirat azt mutatja. Ma nincs ilyen változó a compose-ban, és nincs ok rá; elfogadható.
- **Eltérő web- és gyökérverzió:** ha egyszer a `bumpp` csak a gyökeret emelné, a felirat a web régi számát mutatná. Ma mindkettőt emeli; a kiadási menet része.

## Elfogadási feltételek

1. **E2E-teszt:** a `/` oldal HTML-je tartalmazza a `v` + `web/package.json` verzióját (a teszt a fájlból olvassa a számot, nem beégetett értékből). A `v` előtag kötelező a keresésben: a Nuxt a `runtimeConfig.public`-ot `v` nélkül az oldal beágyazott adatai közé is beírja, így a puszta számra keresés akkor is zöld lenne, ha a fejléc semmit sem mutat.
2. **Kézi próba helyben:** `pnpm --filter transcript-refinery-web dev` mellett a böngészőben a cím mellett `v1.29.0` (vagy az akkori verzió) látszik.
3. **Élő próba a peter-mba-n** a kiadás után: a web fejlécében ugyanaz a szám látszik, mint a `https://refinery-mba.peteroncode.dev/version` válaszában. Nem feltétele a kód-PR-nek.

## Ami a tervre marad

- A `runtimeConfig.public` kulcsának neve, és hogy a `package.json` olvasása `import`-tal vagy `readFileSync`-kel történik.
- A pontos osztályok és a felirat elhelyezése a `UContainer`-en belül.
