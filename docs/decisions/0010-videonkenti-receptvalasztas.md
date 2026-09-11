# 0010 — A receptválasztás videónként is lehetséges

**Dátum:** 2026-09-11 · **Státusz:** elfogadva ·
**Felülírja:** az `architecture.md` §10 „a receptválasztás futás-szintű" részét

## A kérdés

Az `architecture.md` §10 a köteg listájáról kimondta: *„A per-sor
felülbírálás (CSV, YAML) szándékosan kimarad: a receptválasztás
futás-szintű, és a per-elem igény spekulatív."* Egy futás egy receptet vitt
végig minden kiválasztott elemen.

A Fázis 5 queue-jegyzetének tervezésekor az igény valódinak bizonyult: az
egyik videóhoz összefoglaló kell, kártya nem; a másikhoz fordítva; a
harmadikhoz mind. Futás-szintű recepttel ez receptenként külön futást és
külön kiválasztást jelentene, ugyanarra a listára.

Maradjon-e futás-szintű a receptválasztás?

## A döntés

**Nem. A feldolgozási sorban (`_queue.md`) a választás videónként és
receptenként történik, és a `run` (videó, recept) párokon fut.**

- A sor videónként receptenként egy pipát ad; a pipa jelentése: „ehhez a
  videóhoz ezt a receptet kérem". A pipeline a pipához nem nyúl.
- A `run --queue` a kipipált, még nem kész párokat dolgozza fel, **egyetlen
  közös becsléssel és költségőrrel** — a plafon az egész indításra vonatkozik,
  nem receptenként.
- A `run --recipe X` a `--queue` nélkül továbbra is futás-szintű.

## Mi döntötte el

**1. A spekuláció helyett valódi igény áll.** A §10 ítélete arra épült, hogy
per-elem igény nincs. Ez a feltétel szűnt meg — nem az érvelés bizonyult
hibásnak.

**2. A formátumnak nem kell CSV-nek vagy YAML-nak lennie.** A §10 azért zárta
ki a per-sor felülbírálást, mert az a kézzel kellemesen bemásolható sima
szöveget cserélte volna le. A pipálható Markdown-lista ezt az árat nem kéri:
Obsidianban natív, és kézzel is szerkeszthető.

**3. A pár a helyes egység, nem a receptenként ismételt futás.** Receptenként
külön indított futás receptenként külön becsülne: a második recept úgy is
elindulhatna, hogy a becslése a teljes plafonba belefér, a már elköltött
maradékba viszont nem. Ez a `decisions/0004` „plafon fölött el sem indul"
garanciáját gyengítené.

## Következmények

- A futás egysége a (videó, recept) pár; a becslés bejegyzésenkénti
  iterációszámmal szeletel.
- A hibalista (videó, típus) párokra bomlik — egy videó második recepthibája
  többé nem írja felül az elsőt.
- A queue-jegyzet az egyetlen vault-fájl, amit a pipeline helyben frissít:
  atomi írással, és csak a saját részeit (`architecture.md` §7).
- A CLI `--recipe` kapcsolója továbbra is egyetlen értéket fogad; több receptet
  egy futásban a sor ad.
- Spec: [`plans/2026-09-11-fazis-5-queue-jegyzet-spec.md`](<../plans/2026-09-11-fazis-5-queue-jegyzet-spec.md>).
