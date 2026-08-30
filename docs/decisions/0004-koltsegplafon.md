# 0004 — A költségplafon két rétegben

**Dátum:** 2026-08-30 · **Státusz:** elfogadva

## A kérdés

A projekt egyik kimondott korlátja, hogy **köteg nem indul futásonkénti felső
korlát nélkül.** Az viszont nyitott volt, hogy ezt ki tartatja be: a modelleket
kiszolgáló LiteLLM gateway, az alkalmazás, vagy mindkettő.

## A döntés

**Mindkettő, két független rétegben.**

- **A LiteLLM a kemény kapu.** A projekt saját virtuális kulcsot kap saját havi
  kerettel, elköltés-követéssel és sebességkorláttal.
- **Az alkalmazás a lágy kapu.** Előzetes becslés indulás előtt, megadható plafon,
  ami alatt el sem indul, és futás közbeni megszakítás a modellválaszok használati
  adatai alapján.

## Elvetett alternatívák

**Csak a LiteLLM.** Kevesebb kód és egyetlen igazságforrás. Elvetve: nincs előzetes
becslés, a hibát félútról kapod meg, és a futás félig igényelt állapotban áll le —
egy több tucat elemű kötegnél ez rossz.

**Csak az alkalmazás.** Nem függ attól, hogy a LiteLLM Postgres-háttérrel fut-e. Elvetve: nincs kemény
hátsó fal, és egy hibás becslés vagy egy megkerülő hívási út korlátozás nélkül
költene.

## Mi döntötte el

A becslés **ingyen van.** Normalizálás után a szószám lokálisan, modellhívás nélkül
megszámolható, és az iterációs korlát miatt a szorzó is ismert felülről. Így a
követelmény nem absztrakt szabállyá válik, hanem **konkrét számmá a futás előtt** —
amit ráadásul a felület meg tud mutatni.

A kemény hátsó falra ettől függetlenül szükség van, mert a becslés tévedhet.

## Kapcsolódó, itt eldöntött kérdések

**A LiteLLM telepítése nem része ennek a projektnek.** Ez korábban ellentmondásos
volt: az egyik szakasz kimondta a scope-határt, egy másik mégis telepítési utat
kért. A határ marad: a rendszer adottnak veszi, hogy egy OpenAI-kompatibilis
LiteLLM gateway elérhető, és csak fogyasztja — alap-URL és kulcs környezetből, induláskor
validálva.

**A modellválasztás mérési eredmény, nem vélemény.** A receptek nem modellnevet
kérnek, hanem szerepet (`draft`, `judge`), amit a konfiguráció képez le. A konkrét
modell akkor dől el, amikor a mérőhalmazon több jelölt lefutott, és a mért hűség és
lefedettség dönt, egységnyi költségre vetítve.

**Lokális szöveggeneráló modell nem fut.** A transzkripció lokális, a
szöveggenerálás nem. A dokumentáció ezt így mondja ki, „local-first" címke nélkül —
a pontos megfogalmazás: *lokális transzkripció, hosztolt generálás.*
