# Mérés — a fordítás kimeneti aránya és a hosszú forrás

**Dátum:** 2026-09-17 · **Költés:** $0.06 (a `/key/info` szerinti spend-különbség: $8.039154750000009 − $7.980151650000007 ≈ $0.06, egyezik a szkript saját könyvelésével) · **Modellek:** vázlat `minimax-m3`, bíró `grok-4-fast-reasoning`

## Kérdés

A fordítórecept kezdő `outputRatio` értéke (1,5) feltevés volt. Mennyi a valós
kimenet a forrásjegyzet arányában, és lefordítható-e egy hosszú forrás egyetlen
hívásban, időtúllépés nélkül?

## Módszer

A vaultban kész `clean`, `summary` és `notes` jegyzetek, receptenként legfeljebb
három, egy generálással és a teljes rubrikával. Külön egy kb. 16 800 szavas
valódi átiratból bekezdésekre tördelt, időbélyeges szintetikus forrás, egyetlen
hívással, bíró és újrapróbálkozás nélkül. Szkript:
`pnpm calibrate:translate --budget 1.4`. A nyers adat privát, verziókövetésen
kívül.

Az öt tervezett mintából egy (`clean-hu`, 4167 szó) 3 próbálkozás után
`Headers Timeout Error` hibával elbukott — a hívás nem jutott el a modellig
kiértékelhető válasszal. A maradék négy (3× `summary-hu`, 1× `notes-hu`) lefutott.

## Az ismétlődés a videók között (a tervezés előtti mérés)

A 19 angol feliraton a 8 szavas szakaszok 0,16%-a (190 / 115 264), a 12 szavas
szakaszok 0,11%-a (123 / 115 275) fordul elő más videóban is — egyetlen csatorna
visszatérő videózáró szövege. Ezért nincs fordítási memória.

## Eredmény

| recept | szó | kimeneti token | arány | pontszám | $ |
|---|---|---|---|---|---|
| summary-hu | 1060 | 3024 | 2.11 | 0.00 | 0.004 |
| summary-hu | 1432 | 4668 | 2.41 | 0.00 | 0.006 |
| summary-hu | 1391 | 3968 | 2.11 | 0.00 | 0.005 |
| notes-hu | 1648 | 12620 | 5.67 | 0.00 | 0.016 |

Hiba: `clean-hu`, 4167 szó — `Failed after 3 attempts. Last error: AI_APICallError: Cannot connect to API: Headers Timeout Error`.

Hosszú forrás: 16812 szó, 729 mp, 21599 kimeneti token, arány 0,95, vázkapu **0**
(hiba nélkül lefutott, de a vázkapu megbukott rajta; a konkrét eltérést a
szkript nem rögzítette, csak a 0/1 ítéletet).

**A négy sikeres minta mindegyike 0 pontot kapott — kizárólag a vázkapu miatt,
nem a bíró miatt.** A hiánylisták 1-2 egységnyi bekezdés- vagy
fejlécszám-eltérést neveznek meg (pl. „The translation has 27 paragraphs, the
source has 25."), miközben az időbélyegek, táblázatsorok, kódkerítések és
linkcélok egyetlen mintában sem tértek el. A négy kimenetet kézzel átolvasva
egyik sem tűnik hiányosnak vagy hibás fordításnak. A bíró egyszer sem futott
le: a blokkoló vázkapu mindig előbb elakasztotta a rubrikát, mielőtt a
fordításhűség-bíróhoz jutott volna a sor.

## Döntés

- `translationOf(…).outputRatio`: 1,5 → **5,68**, a legnagyobb mért arány
  (`notes-hu`, n=1) felfelé kerekítve. A becslés így biztonságos irányba téved
  (a projekt bevett mintája szerint) minden más forrásreceptre, amelynek
  ténylegesen alacsonyabb a mért aránya (`summary-hu`: 2,11–2,41, `clean`:
  hosszú forráson 0,95).
- A bíró: **0 kiértékelhető hiánylista** — a vázkapu egyszer sem engedte át a
  rubrikát a bíróig, tehát a spec 7. lépésének két kérdésére (téves
  szakszó-kifogás száma; valódi jelentésbeli eltérés száma) nincs adat ebből a
  mérésből. Ez önmagában is lelet: a vázkapu + `maxIterations: 0` kombináció
  jelenleg minden mért valós fordítást elakaszt, mielőtt a bíró egyáltalán
  megszólalna.
- Darabolás: **nem dönthető el ebből a mérésből**. A hosszú forrás nem
  időtúllépéssel bukott (729 mp alatt hiba nélkül lefutott), hanem
  vázkapu-hibával — ez valószínűleg ugyanaz a jelenség, mint a rövidebb
  mintáknál (bekezdés-/fejlécszám-csúszás), csak felnagyítva, de a konkrét
  eltérést a szkript nem rögzítette. Külön issue nyílt a kérdésre:
  [#42](https://github.com/pcsontos/transcript-refinery/issues/42) — sem a
  vázkapu-tolerancia lazítása, sem a darabolás nem ennek a szeletnek a
  feladata.
- **A `clean-hu` időtúllépése** (4167 szó, 3 próbálkozás után hiba) megerősíti
  a spec „Kiindulási állapot" szakaszában már jelzett, egyetlen adatpontra
  épülő gyanút (`Headers Timeout Error` egy ~9989 szavas `clean` átiraton) —
  most rövidebb hosszon is jelentkezett. Ez a `clean` recept saját,
  e szeleten kívüli ügye marad (`model/client.ts:52`, válaszfolyam nélküli
  `generateText`-hívás); nem nyílt rá külön issue e mérés kapcsán, de a
  kockázat immár a fordításra nézve is megerősített.

## A mérés korlátja

Kevés elem, egy ismétlés, egy modellpár: az arány tokenizáló-függő, más
vázlatmodellnél újra mérendő. A `notes-hu` arány egyetlen mintán alapul. Egy
kliensoldali időtúllépés után a proxy a generálást befejezheti és
kiszámlázhatja — ezért a költés a `/key/info` szerinti, nem a szkript saját
könyvelése (ez a mérésben egyezett, de a különbség módszertanilag a hiteles).
