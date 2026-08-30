# 0006 — Mérés: Evalite futtató, saját rubrikákkal

**Dátum:** 2026-08-30 · **Státusz:** elfogadva

## A kérdés

A mérés ennek a projektnek nem kiegészítője, hanem a fele. A kérdés, mivel mérünk
TypeScriptben. Az iparági alapértelmezés (RAGAS) Python, tehát itt nem játszik.
A szóba jött TypeScript-jelöltek: Evalite, autoevals, Braintrust, Langfuse, vagy
saját harness az AI SDK telemetriájára építve.

## A döntés

**Rétegezve:**

- **A rubrikák sima TypeScript modulok**, a receptek mellett. Nem a
  keretrendszerben laknak.
- **A futtató és a riportálás az Evalite** — Vitest-alapú, lokális, account nélkül
  futtatható.

## Mi döntötte el

**1. A rubrika nem lakhat a keretrendszerben.**

Ez az `0001` döntés közvetlen következménye: a rubrika két helyen fut — futásidőben
az optimalizáló loop jeleként, méréskor pontozóként. Ha egy platform felületén
konfigurált pontozó volna, a futásidejű loop nem tudná importálni, és azonnal két,
egymástól elcsúszó igazságunk lenne.

Ez a kritérium önmagában kizárja azokat a megoldásokat, ahol a pontozó a platform
tulajdona.

**2. Egy idegennek le kell tudnia futtatni.**

Ha a méréshez fiók, kulcs vagy felhő kell, akkor a repó legfontosabb bizonyítéka
nem ellenőrizhető. Egy publikus portfólió-repónál ez elfogadhatatlan.

**3. Ez oldja meg a demó-problémát is.**

A kimenet privát jegyzet, tehát nehéz volt megmondani, mit lehet egyáltalán
megmutatni. Egy **lokális mérőfelület, ami modell-jelöltek pontszámait mutatja a
mérőhalmazon, kiváló bemutató — és egyetlen privát jegyzetet sem tár fel.**

**4. Egy tesztfuttató.** A mérés Vitestre épül, ami a unit tesztekhez amúgy is kell.

## Elvetett alternatívák

**Saját harness a nulláról.** Teljes kontroll, és önmagában is portfólió-tartalom.
Elvetve: a riportot, a pontszám-történetet és a felületet is meg kellene írni —
idő, ami nem a tényleges mérési kritériumokra megy.

**Langfuse (self-hosted).** Nyomkövetés és mérés egyben, perzisztált
összehasonlításokkal. Elvetve: még egy szolgáltatás saját adatbázissal, és egy
idegen nem tudná futtatni a mérést anélkül, hogy felállítaná — ami pont az
ellenőrizhetőséget rontja.

**Braintrust (felhő).** Kész pontozó-könyvtár, nulla üzemeltetés. Elvetve:
fiókfüggés, és a projekt minden más döntése (lokális futtatás, privát hálózat,
nincs publikus kitettség) ellentétes irányba mutat.

## Következmények

- A pontozók egy része **modellhívás nélküli** (formátum-megfelelés): sima
  függvény, nulla token. Ez a hibák jelentős részét kiszűri, mielőtt bármi drága
  elindulna.
- A hűség-mérés **referencia nélküli**: a viszonyítási alap maga az átirat.
- A lefedettség-méréshez videónként egy kulcspont-lista kell; kézzel írt
  referencia-jegyzeteket szándékosan nem készítünk.
- A mérés a modellválasztás eszköze is: a `draft` és a `judge` szerep konkrét
  modellje mért eredmény alapján dől el.
