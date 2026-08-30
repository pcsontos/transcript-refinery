# 0005 — Egyetlen, lokális transzkribálási út

**Dátum:** 2026-08-30 · **Státusz:** elfogadva

## A kérdés

A korpusz 47%-a (72 videó, nagyjából 28 óra hang) automatikus feliratozású, tehát
újra kell transzkribálni. Ez két különböző munka:

- **Backfill** — a felhalmozódott 72 videó egyszeri feldolgozása.
- **Folyamatos üzem** — az ezután érkező videók, hetente néhány.

Egy korábbi döntés két utat írt elő: Groq Whisper API a gyors backfillre, lokális
whisper a folyamatos üzemre. A részleteket viszont ide utalta, egy kimondott ellenérvvel
együtt.

## A döntés

**Egyetlen út: lokálisan futó `whisper.cpp`, `medium.en` modellel** — a backfillre
és a folyamatos üzemre egyaránt. A Groq Whisper API-t nem használjuk.

## Mi döntötte el

**1. A két út megmérgezné a mérést.**

A mérési halmaz ebből a korpuszból jön. Ha a backfill a Groq API-val készül, az
jobb minőségű átiratokat ad, mint amit az éles üzem valaha előállít — vagyis a
projekt fő bizonyítéka egy olyan bemeneti minőségen mérne, ami a valóságban nem
áll elő. Egy projektben, aminek a tézise a mérési szigor, ez nem szépséghiba.

**2. Rossz szakadékot optimalizálnánk.**

Az írásjelek nélküli, központozatlan ASR-szövegtől bármelyik whisperig **óriási** a
javulás. A `medium.en` és a Groq `large-v3` közti különbség ehhez képest
keskeny. Ezért a keskeny sávért kellene egy egész alrendszert megírni.

**3. Az alrendszer csak a felhő-úton létezik, és csak egyszer futna le.**

A Groq Whisper API-nak 25 MB-os fájlméret-limitje van. A 72 videó hanghossza medián 19 perc, p90
41, maximum 72. Tömörítetlen formátumban a fájlok 76%-a lépi túl a 25 MB-os
limitet; veszteségmentes tömörítéssel is 27%. Vagyis kellene: formátumkonverzió,
**darabolás, átfedéskezelés és időbélyeg-eltolásos visszafűzés** — hibákra hajlamos
kód, ami a backfill után soha többé nem futna le. Ezt egy jó mérnök törli, nem
megírja.

**4. A sebesség-ellenérv gyenge.**

A host gép tervezetten folyamatosan ébren van. A teljes backfill lokálisan
nagyjából három–kilenc óra, egy éjszaka alatt, felügyelet nélkül. Ez nem költség.

## Elvetett alternatívák

**Két út darabolással** (a teljes backfill Groqon). A leggyorsabb és a legjobb
minőségű — de megírandó a teljes darabolás-visszafűzés alrendszer, és megmarad a
mérési torzítás.

**Hibrid méret szerint:** a rövid fájlok Groqon, a hosszúak lokálisan. Ez
elkerülné a darabolást, és a készlet nagyjából háromnegyede percek alatt kész
lenne. Elvetve, mert a korpusz vegyes transzkript-minőségűvé válna, és a mérés
csak rétegezve tudna tisztán mérni — kisebb elemszámmal rétegenként.

**Csak Groq, lokális whisper nélkül.** Egységes minőség, nincs mérési torzítás.
Elvetve: a darabolás így állandó komponens lenne, minden új videó pénzbe kerülne,
és a rendszer hálózatfüggővé válna ott, ahol egyébként teljesen offline.

## Következmények

- **A rendszer az LLM-hívásokon kívül teljesen offline.**
- Nincs Groq-függés, és a `@ai-sdk/groq` csomag sem kerül be.
- Veszteségmentes hangtömörítés nem kell; `ffmpeg` viszont **kötelező** függőség a
  hangkivonáshoz.
- A `Transcriber` absztrakciónak egy implementációja lesz a v1-ben. Az „már két
  implementációval bizonyított absztrakció" szerep így a `Source`-ra kerül, a
  második fázisban.
- **A származást minden jegyzet frontmatterében rögzíteni kell** (a felirat eredete
  és a modell neve), különben a mérés nem tudja, mit mér.
- A Groq-implementáció később, darabolás nélkül is beköthető, ha valaha kell.
