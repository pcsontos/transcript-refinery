# LLM-es MDX-átalakítás — próbamérés (#278)

**Dátum:** 2026-10-30/31 · **Modell:** `sub2api--claude-sonnet-5-5` (2 $ / 10 $ millió tokenenként) · **Terv:** `docs/plans/2026-10-30-llm-mdx.md`, 7. feladat

## Mérések

| Lépés | Tétel | Szó | Eredmény | Költség |
|---|---|---|---|---|
| 2. kis próba | `summary` (IBM Technology, `c57vAe-mMLo`) | 367 | final | 0,0127 $ |
| 2. kis próba | `clean-moderate` (Sajjaad Khader, `E6lvgbayD04`) | 267 | final | 0,0167 $ |
| 3. minta | `clean-deep` en (`Iq79JvD6uvg`) | 12 690 | final | 0,350 $ |
| 3. minta | `clean-deep` hu (`70w7ux5o4e8`) | 12 944 | **failed** (félkövér bevezető címmé emelve) | 0,829 $ |
| 3. minta | `clean-deep` hu (`B_BIjNEcFUw`) | 10 775 | final | 0,801 $ |
| 3. újrafuttatás a javítás után | `clean-deep` hu (`70w7ux5o4e8`) | 12 944 | final | 0,620 $ |
| 4. elfogadási deploy | az `c57vAe-mMLo` és `E6lvgbayD04` tétel 5 oldala | 5 oldal | 4 final, 1 failed | 0,249 $ |

Összes valódi költés: **kb. 2,88 $**. Második deploy a két tételre: 0 írás, 0 commit, 0+0 token (elfogadás 5.).

## Következtetések

- **Költség/szó:** angol ~0,028 $, magyar ~0,048–0,074 $ ezer szavanként (a magyar 1,7–2,6-szor drágább).
- **Darabméret:** `MDX_CHUNK_WORDS` = 8000 marad; nem jött `finish_reason: length` és nem volt időtúllépés. A leghosszabb tétel (~13 000 szó) kb. 350 s volt. Egy újrafuttatásnál a mért idő (11 s) nem hihető, az okát nem vizsgáltuk.
- **Bukás 1 (javítva):** a modell a sor eleji félkövér bevezetőt (`**Cím.** Szöveg`) címmé emelte, az ellenőrzés az új címet eldobta. Döntés (felhasználó, 2026-10-30): a sor eleji félkövér szöveg ismert cím; commit `d0f3205`.
- **Bukás 2 (valódi átfogalmazás):** a `c57vAe-mMLo` fordított `clean-moderate.hu` oldalán a modell átfogalmazott (755. szó: várt „review-vá válik Mert most már nem", kapott „review lesz de a szöveg szerint"). Az ellenőrzés elkapta, az oldal fallback + `mdx_failed` lett. Ez az anti-cél kapuja működik; a `--retry-failed` újra megpróbálja.
- **Kis-nagybetű:** a lazításra nem volt szükség, ilyen bukás nem jött.
- **Bukási arány:** 10 oldalból 2 bukott, ebből 1 a javítással megoldódott, 1 valódi átfogalmazás. A minta kicsi.

## Komponenshasználat és prompt-iteráció

Az elfogadási deploy után a felhasználó jelezte: a modell a bevezetőn kívül egyetlen komponenst sem használt (négy deployolt oldalon pontosan egy `Callout`, a bevezető), csak széthúzta a szöveget. Ok: a prompt „csak ahol a szöveg kínálja" szabálya (a spec 4. pontja) túl óvatos volt. Döntés (felhasználó, 2026-10-31): erősen ösztönözzön, Steps/Cards/Accordions/Tabs/Callout, a szó szerinti szabály marad.

| Kör | Prompt | Oldal | Komponensek | Költség |
|---|---|---|---|---|
| 1 | ösztönző szabály, példákkal | `summary`, `clean-moderate` (kicsi) | Tabs a korszakokra, Accordion a bemutatkozásra, `warning` | 0,037 $ |
| 2 | sorrend → Steps, Accordion nem a törzsre, `warning` csak valódi figyelmeztetésre | ugyanaz | Steps a korszakokra, a bemutatkozás alcím, `warning` megszűnt | 0,032 $ |
| 3 | ugyanaz | IBM `clean-moderate.en` (2000 szó) | Steps (5), Cards (2), Callout (2) | 0,088 $ |

Összesen 0,157 $. A kis `clean-moderate` oldal csak Callout-ot kapott (beszélgetős intro, nincs lépéssor vagy fogalomlista). Ismert: a `Step` belsejében a korszak címe `###` címként marad (a `Step`-nek nincs `title` attribútuma). Ezek a kimenetek **nem kerültek a showroomba**: a már kint lévő, régi prompttal készült négy oldal újraírásához `--retry-failed` nem elég (nem fallback), ezt külön kell eldönteni.

## Backfill-becslés

A showroomban most `mdx_fallback: true` oldal, LLM-fajtára (`clean-*`, `summary`, `notes`), nyelvenként:

| Fajta | en (oldal / szó) | hu (oldal / szó) |
|---|---|---|
| clean-mild | 6 / 14 009 | 10 / 76 386 |
| clean-moderate | 14 / 69 962 | 18 / 125 187 |
| clean-deep | 9 / 26 896 | 17 / 115 928 |
| notes | 12 / 19 432 | 18 / 27 443 |
| summary | 36 / 29 226 | 32 / 34 607 |
| **összesen** | **77 / 159 525** | **95 / 379 551** |

Ezen felül 1 oldal már `mdx_failed`, azt a backfill nem érinti (csak `--retry-failed`).

- **Becslés:** 159 525 en szó × 0,028 $ + 379 551 hu szó × 0,048–0,074 $ ezer szavanként = **kb. 22,7–32,6 $**.
- **2× ráhagyással: kb. 65 $.** Ez 5 $-os adagokban kb. 13 `refinery deploy` futás (a tényleges költés a mérések alapján 23–33 $ körül várható, ennyi adag is elég).
- A teljes kör a kézi `refinery deploy` ismételgetése; minden futás legfeljebb 5 $-ig hív, közben a site és a jelentés ellenőrizhető. A futás előtt a felhasználó dönt.

## Még a felhasználóra vár

- A 2. lépés mentett törzseinek átnézése (bevezető, tagolás, kiemelés mértéke).
- A 4. lépés site-os szemrevételezése: Workers Build zöld, a bevezető blokk és a szakaszcímek látszanak.
