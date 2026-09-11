# 0011 — A webes felület csak olvas

**Dátum:** 2026-09-11 · **Státusz:** elfogadva

## A kérdés

A roadmap Fázis 5-je „áttekintő és átnéző réteget, élő haladásjelzéssel" ígér a
mag fölé. Nyitva maradt, mit tehet ez a felület: csak mutat, vagy futtat is? Kér-e
jóváhagyást, mielőtt egy jegyzet a vaultba kerül? Honnan kapja az adatot, és hol
marad meg a bíró indoklása, amit ma a futás végén eldobunk?

## A döntés

**A felület csak olvas.** Áttekintést és átnézést ad, és élőben követ egy
CLI-ből indított futást — de futást nem indít, nem szakít meg, és jóváhagyást
nem kér.

- Az adatot a mag csak olvasó rétegén át kapja: írásvédett állapottár-kapcsolat,
  nézetmodellek, a futásnapló követése. A `web/` szerverútvonalai egy-egy
  mag-függvényt hívnak.
- A bíró hiánylistája az állapottárba kerül, műtermékenként egy JSON-sorban.
- Csak a `127.0.0.1`-en figyel, hitelesítés nélkül.

## Mi döntötte el

**1. A futtatás és a válogatás már megvan.** A válogatás a queue-jegyzet dolga
(`0010`), az indítás a CLI-é. Egy böngészős indítás a futásvezérlés kiemelését
kérné a `cli.ts`-ből, és a `_queue.md` mellé második kiválasztási utat nyitna —
olyan igényre, ami nem jelentkezett.

**2. A jóváhagyás a publikálási utat változtatná meg.** A mag ma a küszöb alatti
jegyzetet is kiírja; egy jóváhagyási lépés ezt a szerződést írná át. Előbb
érdemes látni, mennyi és milyen jegyzet marad a küszöb alatt — ezt a felület
most megmutatja.

**3. Az adatlogika a magban tesztelhető.** A három megvizsgált út közül:

- *Nuxt a repóban, a mag olvasó rétegén át* — ezt választottuk: a lekérdezések
  és a követés logikája Vitesttel tesztelt, a típusok közösek, a felület vékony.
- *`refinery serve` a CLI-ben, statikus Nuxt-klienssel* — elvetve: kézzel
  építenénk meg a szervert, amit a Nitro ad.
- *Nuxt a CLI JSON-kimenetén át* — elvetve: minden nézethez új parancs és
  kérésenként folyamatindítás kellene.

**4. A hiánylista az állapottárba, nem a jegyzetbe kerül.** A frontmatterben
túlélné az állapotfájl törlését, de a bíró kritikája a tudásjegyzet része lenne,
és a vault kimeneti formátuma változna. Az egyetlen fogyasztója a felület.

## Következmények

- A mag új olvasó modulokat kap (`src/state/reader.ts`, `src/view/`,
  `src/run/follow.ts`), az állapottár egy új táblát (`artifact_gaps`).
- A futásnapló sorai időbélyeget kapnak, és két új eseményt: `run:started`,
  `run:ended`. A `item:generating` és az `item:scored` mostantól kibocsátódik.
- A változás előtt készült jegyzetekhez nincs hiánylista; csak `--force`
  újrafuttatással pótolható, valós költséggel.
- Spec: [`plans/2026-09-11-fazis-5-nuxt-felulet-spec.md`](<../plans/2026-09-11-fazis-5-nuxt-felulet-spec.md>).
