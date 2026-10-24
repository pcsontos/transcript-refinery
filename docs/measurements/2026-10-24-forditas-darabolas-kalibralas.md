# Mérés — a darabolt fordítás költsége és a darabméret

**Dátum:** 2026-10-23 – 2026-10-24 · **Költés:** kb. $2,8, a tool és a szkriptek saját számítása szerint (nem a `/key/info`-ból, lásd „Nem igazolt")

## Kérdés

A darabolt fordítás (#259) lefut-e, átmegy-e a vázkapun, mennyibe kerül az egyhívásoshoz képest, és jó-e a 4 000 szavas kezdő küszöb (`translate.chunk_words`)?

## Tárgy (eltér a spectől)

A spec a `zgWUhE6HjrI` webináriumot nevezte meg, de az a jegyzet nincs a helyi állapottárban (a peter-mba-n van). Helyette a helyi `-QFHIoCo-Ko` elem (Matt Pocock: „Full Walkthrough: Workflow for AI Coding", `clean-moderate`, 17 510 szó) szolgált. **Ez rövidebb, mint a webinárium (44 ezer szó fölött), ezért a webináriumon látott időtúllépés hatását nem fedi le.** Az egyhívásos fordítás itt is lefutott.

## Módszer

1. Egyhívásos alapvonal (a darabolás előtti kóddal): `refinery run --recipe clean-moderate-hu --force --no-commit --limit 1`.
2. Ugyanez a darabolt kóddal (`chunk_words` 4 000, 6 darab).
3. Diagnosztika: egyetlen darab szójegyzékkel és az eredeti egyhívásos prompttal, ugyanazon a szövegen (3 390 szó), `tsx`-szkripttel.
4. Egy 7 548 szavas darab (`chunk_words` 8 000 szerinti első darab) szójegyzékes prompttal.

Modell: `sub2api--grok-4.7` a draft szerepben. Az ára (2/6 $/M) nem ellenőrzött: a `refinery check-pricing` szerint a LiteLLM nem ismeri.

## Eredmény

| futás | idő | be (token) | ki (token) | költség |
|---|---|---|---|---|
| egyhívásos, 17 510 szó | ~12 perc | 26 094 | 44 835 | $0,32 |
| darabolt, 6 × ~3 000 szó | ~43 perc | 49 500 | 265 878 | $1,66 |

- **Működés:** mind a 6 darab elsőre sikerült, a vázkapu pontszáma 1,00, 0 hiány, a szerkezet megmaradt (27 fejléc mindkét változatban), a kimenet 14 164 szó mindkettőben.
- **Szójegyzék:** 285 sor, a mintavett 268-ból 179 azonos forrás- és célszó. Az egyedi fordítások következetesek (`smart zone` → `okos zóna`, `dumb zone` → `buta zóna`, `sediment` → `üledék`). A mintavett kifejezések következetessége az egyhívásos fordításéval gyakorlatilag azonos volt (`okos zóna` 4/4, `context window` 7/7 maradt angolul); **a szójegyzék ezen a mintán nem javított mérhetően**, mert az egyhívásos fordítás is következetes volt.
- **A többlet oka nem a szójegyzék.** Ugyanaz a 3 390 szavas darab:

| prompt | be | ki | idő |
|---|---|---|---|
| szójegyzékkel | 8 067 | 41 645 | 397 mp |
| anélkül (eredeti) | 7 898 | 40 803 | 344 mp |

  A szójegyzék a kimenethez kb. 2%-ot adott.
- **A kimeneti token nem követi a darab méretét.** 3 390 szóra 41,6 ezer, 7 548 szóra 38,7 ezer (13 392 be, ~524 mp, nem csonkolt, a szójegyzék teljes), a teljes 17 510 szóra 44,8 ezer. A mérések egy hívásonként nagyjából fix, ~40 ezer tokenes kimenetre utalnak (valószínűleg belső gondolkodás), amelyet a darabok száma szoroz.

## Következtetés

- A darabolás költsége a darabok számával nő, ezért a nagyobb darab olcsóbb. A 17 510 szavas jegyzékre 8 000-es küszöbbel 3 darab, kb. 120 ezer kimeneti token, kb. $0,8 várható (**becslés** a fix hívásköltségből, teljes futás nem volt).
- **Döntés:** `DEFAULT_CHUNK_WORDS` 4 000 → **8 000** (ugyanebben a PR-ben).
- Ennél nagyobb küszöb nincs mérve: egy darab ideje nő (a 7 548 szavas ~9 perc), megszakadáskor nagyobb rész vész el.

## Nem igazolt

- A hívásonkénti fix kimenet **oka**: három mérésből következtetés, a modell belsejét nem láttam.
- **A valós költség.** A LiteLLM `/key/info` spendje a két teljes futás között nem változott (4,838863), ezért csak a tool saját számát ismerem; a korábbi tapasztalat szerint az eltérhet a valóstól.
- A 8 000-es küszöb teljes (3 darabos) futása, és a webináriumon az időtúllépés viselkedése.
- A szójegyzék haszna rövid, következetes anyagon nem látszik; az előnyét hosszabb, kevésbé egységes anyag mutathatná.
- Egy ötlet a zaj csökkentésére (a `forrás = cél` párok kihagyása) szándékosan nem került be: ez eltér a spec szövegétől, és külön döntés.
