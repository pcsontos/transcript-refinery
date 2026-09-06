# Tervdokumentáció

Ennek a mappának az a célja, hogy a döntések utólag is olvashatók legyenek: mi
mellett döntöttünk, mit vetettünk el, és **mi döntötte el.** A commit-történettel
együtt ez a dokumentáció a projekt egyik terméke, nem melléktermék.

| | |
|---|---|
| [`architecture.md`](<./architecture.md>) | a csővezeték, az absztrakciók és a megkötések |
| [`evaluation.md`](<./evaluation.md>) | mit mérünk, mivel és min |
| [`roadmap.md`](<./roadmap.md>) | fázisok, megfigyelhető sikerkritériumokkal |
| [`decisions/`](<./decisions/>) | egy rekord minden érdemben vitatott döntésről |
| [`plans/`](<./plans/>) | fázisonkénti implementációs tervek, feladatokra bontva |

## A döntések

| # | Kérdés | Válasz |
|---|---|---|
| [0001](<./decisions/0001-agens-reteg.md>) | ágensréteg | evaluator–optimizer loop, válogató ágens nélkül |
| [0002](<./decisions/0002-dokumentumtipus-egyseg.md>) | bővítés egysége | a dokumentumtípus egy kódmodul |
| [0003](<./decisions/0003-ingest-sorrend.md>) | melyik forrás az első | a Pinchflat letöltési mappája, nem az URL (felülírva: 0008) |
| [0004](<./decisions/0004-koltsegplafon.md>) | költségkorlát | két réteg: LiteLLM és alkalmazás |
| [0005](<./decisions/0005-transzkribalasi-ut.md>) | transzkribálás | egyetlen út: lokális `whisper.cpp` (felülírva: 0008) |
| [0006](<./decisions/0006-eval-stack.md>) | mérési keretrendszer | Evalite, saját rubrikákkal |
| [0007](<./decisions/0007-elso-szelet.md>) | az első szelet | normalizálás vault-írással, modell nélkül |
| [0008](<./decisions/0008-forras-fuggetlen-bemenet.md>) | mi a bemenet | a kész feliratfájl; a forrás és a transzkribálás kívül esik |

A döntéseket alakító személyes kontextus — géppark, meglévő privát infrastruktúra,
karriercélok — szándékosan a repón kívül marad.
