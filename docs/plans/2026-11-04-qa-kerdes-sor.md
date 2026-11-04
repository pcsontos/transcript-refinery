# A qa kártya üres sor nélküli válasszal — implementációs terv (#361)

> **Végrehajtás:** natívan, ebben a munkamenetben (Read/Edit/Bash), skill és alügynök nélkül. A lépések `- [ ]` jelölésűek.

**Cél:** a `cardsMdx` a `qa` jegyzetet akkor is kártyákra bontja, ha a `**…?**` kérdéssor alatt a válasz üres sor nélkül kezdődik.

**Felépítés:** egyetlen változás a `cardsMdx` bekezdés-ciklusában: `qa`-nál a bekezdés **első sorát** vizsgáljuk a `?**` végződésű félkövér mintára, a bekezdés többi sora a válasz első bekezdése.

**Eszközök:** TypeScript, vitest, tsx.

**Spec:** `docs/plans/2026-11-04-qa-kerdes-sor-spec.md`

## Globális megkötések

- Csak a `qa` ág változik; a `## ` címsoros kérdés, a `flashcards` és a `bloom` viselkedése bájtra azonos marad.
- Kérdés: a bekezdés első sora, sor végi szóközök levágása után, egészében `**…?**`.
- A kártya címe a csillagok nélküli kérdés, `?`-lel együtt.
- A vault-ellenőrző szkript eldobható, nem kerül a repóba.

## Review-fókusz

1. **Sor végi szóközös kérdéssor** (`**Mi ez?**␣␣\nV`) → kérdésnek számít. Teszt: 1. feladat, 1. lépés.
2. **`?` nélküli, teljesen félkövér bekezdés a válaszban** → a válasz része, nem új kártya. Teszt: 1. feladat, 1. lépés.
3. **Vegyes jegyzet** (egyik kérdés üres sorral, a másik anélkül) → mindkettő kártya. Teszt: 1. feladat, 1. lépés.
4. **Valós vault-jegyzetek** → egyik sem `null`. A 2. feladat ellenőrzi.

---

### 1. feladat: a kérdés a bekezdés első sora

**Fájlok:**
- Módosítás: `src/deploy/cards.ts` (a `for (const part of parts)` ciklus)
- Teszt: `src/deploy/cards.test.ts`

**Interfész:** a `cardsMdx(body: string, siteKind: 'flashcards' | 'qa' | 'bloom'): string | null` szignatúrája nem változik.

- [ ] **1. lépés: a bukó tesztek** (a „qa: ## **kérdés** alak is” teszt után)

```ts
  it('qa: a válasz üres sor nélkül követi a kérdést', () => {
    const out = cardsMdx('# Cím\n\n**Mi ez?**\nV1\n\nV2', 'qa')!
    expect(out).toContain('<Accordion title="Mi ez?">\n\nV1\n\nV2\n\n</Accordion>')
  })

  it('qa: sor végi szóköz a kérdéssor után', () => {
    expect(cardsMdx('# Cím\n\n**Mi ez?**  \nV', 'qa')).toContain('<Accordion title="Mi ez?">\n\nV\n\n</Accordion>')
  })

  it('qa: vegyes forma, két kártya', () => {
    const out = cardsMdx('# Cím\n\n**A?**\n\nVA\n\n**B?**\nVB', 'qa')!
    expect(out.match(/<Accordion title=/g)).toHaveLength(2)
    expect(out).toContain('<Accordion title="B?">\n\nVB\n\n</Accordion>')
  })

  it('qa: a ? nélküli félkövér bekezdés a válasz része', () => {
    const out = cardsMdx('# Cím\n\n**Mi ez?**\n\n**V:** **Teljesen félkövér.**\n\nV2', 'qa')!
    expect(out.match(/<Accordion title=/g)).toHaveLength(1)
  })
```

A „bájtra azonos kétszer” tesztben a `['# C\n\n**K**\n\nV', 'qa']` sor helyett `['# C\n\n**K?**\nV', 'qa']` álljon, mellé egy `expect(cardsMdx(body, kind)).not.toBeNull()` a cikluson belül, hogy a determinizmus-teszt valós kimenetet hasonlítson.

- [ ] **2. lépés: futtatás, bukás**

Futtatás: `pnpm test src/deploy/cards.test.ts`
Várt: mind a négy új teszt és a determinizmus-teszt bukik. Az 1–3. és a determinizmus `null` vagy hiányzó accordion miatt; a 4. azért, mert a mai szabály a `**V:** **Teljesen félkövér.**` bekezdést is kérdésnek veszi (2 kártya). A többi meglévő teszt zöld.

- [ ] **3. lépés: a megvalósítás a `cards.ts`-ben**

A ciklusban a `bold` a bekezdés első sorából jön: `qa`-nál `/^\*\*(.+\?)\*\*\s*$/` az első sorra. Ha `bold` talált és a bekezdésnek van további sora, azok `'\n'`-nel összefűzve a kártya válaszának első eleme. A `heading` ág változatlan. A függvény JSDoc-jában a „kérdés” leírása kiegészül: `qa`-nál a `?**`-ra végződő félkövér első sor.

- [ ] **4. lépés: futtatás, zöld**

Futtatás: `pnpm test src/deploy/cards.test.ts && pnpm typecheck && pnpm lint`
Várt: minden teszt zöld, nincs típus- és lint-hiba.

- [ ] **5. lépés: mutációs próba**

A regexből ideiglenesen töröld a `\?`-t → a 4. új teszt bukjon. Töröld a válasz-hozzáfűzést → az 1. új teszt bukjon. Mindkettőt állítsd vissza, a fájl `git diff`-je a 3. lépés állapotát mutassa.

- [ ] **6. lépés: teljes suite**

Futtatás: `pnpm test`
Várt: zöld. (A `watcher.test.ts` ismerten instabil; ha csak az bukik, önmagában futtatva ellenőrizd.)

- [ ] **7. lépés: commit** a `commit-message` skillel (`src/deploy/cards.ts`, `src/deploy/cards.test.ts`).

### 2. feladat: ellenőrzés a valós vaulton

**Fájlok:** eldobható szkript a scratchpadben, a repóba nem kerül.

- [ ] **1. lépés: a szkript**

`tsx`-szel futó szkript, amely a `<vault>/Inbox/transcript-refinery` alatti összes `*_qa.md` fájlt beolvassa, a frontmattert a `src/vault/lint.ts` `FRONTMATTER` regexével levágja (`text.replace(FRONTMATTER, '').trimStart()`, ahogy a `deploy.ts:150`), és mindegyikre meghívja a `cardsMdx(body, 'qa')`-t. Fájlonként kiírja: a kártyák számát (`<Accordion title=` előfordulások) és az elvárt számot (a `/^\*\*.*\?\*\*\s*$/m` sorok + a `^## ` sorok száma), `null` esetén `NULL`-t.

- [ ] **2. lépés: futtatás**

Futtatás: `pnpm exec tsx <scratchpad>/check-qa.ts`
Várt: 15 sor, egyik sem `NULL`, és mindegyikben a kártyaszám megegyezik az elvárttal. A `B_BIjNEcFUw` jegyzet benne van és bontható.

- [ ] **3. lépés: eltérés esetén** állj meg, és jelezd a felhasználónak a fájlt és a két számot; a kódot ne igazítsd a jegyzethez egyeztetés nélkül.

### Élő próba (nem feltétele a kód-PR-nek, a kiadás előtt fut)

`refinery deploy --item B_BIjNEcFUw --kind qa` kiírja az oldalt, „kihagyva” sor nélkül.
