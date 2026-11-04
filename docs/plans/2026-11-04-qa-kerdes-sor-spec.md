Spec — A qa kártya üres sor nélküli válasszal (#361)

**Dátum:** 2026-11-04 · **Státusz:** tervezet

Ez a dokumentum a #361 brainstormingjából készült (2026-11-04).

## A cél egy mondatban

A `refinery deploy` a `qa` jegyzetet akkor is kártyákra bontsa, ha a félkövér kérdéssor alatt a válasz üres sor nélkül kezdődik, ne hagyja ki az oldalt „a kártyák nem bonthatók” üzenettel.

## Miért

- A `refinery deploy --item B_BIjNEcFUw` (2026-11-03) kihagyta a `qa` oldalt. A vault első 8 `qa` jegyzetéből 3 ugyanígy bukott (lásd #361).
- A forma modellfüggő: a hibás jegyzetet a `sub2api--gemini-3.8-flash-high`, a jót a `sub2api--grok-4.7` írta. Mindkettő érvényes Markdown, a modellválasztást nem akarjuk emiatt korlátozni.

## Anti-cél

- **A válasz egy sora tévesen kérdésnek számít**, és a kártya kettéválik. Ez rosszabb a mostani kihagyásnál, mert csendben hibás oldal kerül ki.

## Nem cél

- A `flashcards` és a `bloom` bontásának változtatása.
- A `## kérdés` és a `## **kérdés**` alak változtatása.
- A kézzel írt `**K:** … / **V:** …` formájú jegyzetek bontása. Ezek a `Projects/…` alatt vannak, a deploy pedig csak a `notesRoot` (`Inbox/transcript-refinery`) alól olvas.
- A szárazfutás javítása, hogy előre jelezze a bonthatatlan kártyát (az issue megemlíti, de külön kérdés).
- A recept promptjának szigorítása a kimeneti formára.

## Előfeltétel-tények (ellenőrizve, 2026-11-04)

- **A kód:** `src/deploy/cards.ts` `cardsMdx`. Üres soroknál (`/\n{2,}/`) bontja bekezdésekre a törzset. `qa`-nál kérdés az a bekezdés, amely egészében `/^\*\*([^\n]+)\*\*$/`. A kérdés utáni bekezdések a válasz. Üres válaszú kérdésnél vagy kérdés híján `null`, ilyenkor a `src/deploy/deploy.ts:207` kihagyja az oldalt („a kártyák nem bonthatók”).
- **Teszt:** `src/deploy/cards.test.ts`, benne a „qa: félkövér kérdés-bekezdés” eset (üres sorral elválasztott forma).
- **Mérés a vaulton** (`Inbox/transcript-refinery`, 15 `qa` jegyzet): 310 sor áll teljes egészében félkövérből, és mind a 310 `?**`-ra végződik. Más, teljesen félkövér sor nincs. Egy jegyzet `## ` címsoros kérdéseket használ.
- **A kérdés mindig bekezdés elején áll:** a 310 kérdéssorból 94 után a válasz üres sor nélkül kezdődik (ez a hibás eset), de egyik kérdéssor előtt sem áll nem üres sor. Tehát nincs `**K1?**\nV1\n**K2?**\nV2` alak, a bekezdés első sorának vizsgálata elég, soronkénti bontás nem kell.
- **A kézzel írt jegyzetekben** (`Projects/ai-agensfejlesztes/…`) a `**V:** … **kiemelés.**` válaszsor teljesen félkövérnek látszik. Ezt a mostani szabály is kérdésnek venné, ha külön bekezdésben állna. Deployba nem kerül, de jól mutatja az anti-cél kockázatát.

## A tervezés során hozott döntések

| kérdés | döntés | ki döntött |
|---|---|---|
| Lehet-e a válaszban teljesen félkövér, nem-kérdés sor | A gyakorlatban nem; a kérdést a `?**` végződés jelöli | felhasználó („ha `?**`-ra végződik, az a kérdés”), a vault-mérés alátámasztja |
| A `?**` feltétel a mai, külön bekezdéses formára is vonatkozik-e | Igen, egységes szabály. A mérés szerint ma egyetlen jegyzet sem bukik el miatta | javaslat, a felhasználó jóváhagyta |
| A determinizmus-teszt (`cards.test.ts:70`) `**K**` qa-bemenete | `**K?**`-re cserélendő, különben az új szabály mellett mindkétszer `null` jön, és a teszt semmit nem ellenőriz | saját döntés |
| Sor végi szóközök | Az ellenőrzés előtt le kell vágni őket (a Markdown kemény sortörése, pl. `**K:** …␣␣`) | saját döntés |

## A változás

A `qa` kérdésfelismerése:

- Egy bekezdés **első sora** akkor kérdés, ha (a sor végi szóközök levágása után) egészében félkövér, és `?**`-ra végződik: `**…?**`.
- Ha a bekezdésben a kérdéssor után van még szöveg, az a kérdés válaszának első bekezdése. Az utána következő bekezdések ugyanúgy a válaszhoz tartoznak, mint ma.
- Ha a bekezdés csak a kérdéssorból áll, a viselkedés a mai.
- A kártya címe a csillagok nélküli kérdés, a `?` marad (ahogy ma).

A `## ` címsoros kérdések kezelése nem változik, és a `flashcards`/`bloom` sem érinti.

## Kockázatok és ismert korlátok

- **`?` nélküli félkövér kérdés** (pl. `**Sorold fel a jóga ágait.**`) a változás után nem számít kérdésnek, és ha nincs más kérdés a jegyzetben, az oldal kimarad. A mérésben ilyen nincs; ha megjelenik, a kihagyás látható hiba, nem csendes.
- **Kérdőjellel végződő, teljesen félkövér válaszsor** (pl. egy félkövér költői kérdés a válaszban) új kártyát nyitna. A mérésben ilyen nincs.

## Elfogadási feltételek

1. **Teszt a `cards.test.ts`-ben** az üres sor nélküli formára: `**Mi ez?**\nV1\n\nV2` → egy kártya `Mi ez?` címmel, válasza `V1` és `V2`.
2. **Teszt:** a teljesen félkövér, `?` nélkül végződő bekezdés a válasz része, nem új kártya (`qa`-nál).
3. **A meglévő tesztek zöldek**, köztük a „qa: félkövér kérdés-bekezdés” eset.
4. **A vault mind a 15 `qa` jegyzete** (`Inbox/transcript-refinery`) bontható: a `cardsMdx` egyiknél sem ad `null`-t, és a kártyák száma megegyezik a jegyzet `?**`-ra végződő félkövér sorainak, illetve `## ` címsorainak számával.
5. **Élő próba:** `refinery deploy --item B_BIjNEcFUw --kind qa` kiírja az oldalt, kihagyás nélkül. Nem feltétele a kód-PR-nek, de a kiadás előtt lefut.

## Ami a tervre marad

- A regex pontos alakja, és hogy a felismerés a bekezdés-bontás előtt vagy után történik.
- A 4. feltétel ellenőrzésének módja (eldobható szkript, nem kerül a repóba).
