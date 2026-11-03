# 0013 — A webes felület a peter-mba-n fut, Authelia mögött

**Dátum:** 2026-11-02 · **Státusz:** elfogadva

## A kérdés

A Telegramról indított kérések állapotát útközben, telefonról is követni kell.
A [0011](0011-webes-felulet-csak-olvas.md) a felületet csak a `127.0.0.1`-en,
hitelesítés nélkül engedte, ezért ma csak a fejlesztői Macen, kézzel indítva
érhető el. Hogyan kerüljön ki a peter-mba-ra anélkül, hogy a „csak olvas" elv
vagy a hitelesítés sérülne?

## A döntés

**A felület a daemon image-ben fut a peter-mba-n, Authelia kétfaktoros belépés
mögött, csak olvasható mountokkal.**

- A 0011 „csak a `127.0.0.1`-en figyel" pontja a konténeres telepítésre nem
  érvényes (a konténer `0.0.0.0`-ra köt, a compose adja a címet); a helyi
  `pnpm web` továbbra is `127.0.0.1`-en marad.
- A „csak olvas" pont változatlan: írásvédett állapottár-kapcsolat, se
  futásindítás, se jóváhagyás. A konténerben a csak olvasható mount is
  kikényszeríti, de a kód nem épít rá.
- Egy kivétel mérve: élő író mellett a WAL-módú állapottár csak olvasható
  mounton nem nyílik meg (`unable to open database file`), ezért a web
  konténerben a `/data/state` mappa írható; a kód ettől még `readOnly: true`-val
  nyit.

## Mi döntötte el

**1. Egy image.** A web 9 MB a 888 MB-os image mellett; külön image-nek nincs
értelme, a web ugyanazt az image-et indítja más paranccsal. A futó image
`node_modules`-a csak a mag futási függőségeit tartalmazza, így a teljes image
452 MB.

**2. Közös verzió.** A web az állapottár sémáját ellenőrzi
(`assertCurrentSchema`), eltérésnél hibát dob; a két rész csak együtt működik.
A `web/package.json` ezért mindig a gyökérrel azonos verziót viseli, a `bumpp`
mindkettőt emeli.

**3. A hitelesítés az app előtt van.** Az app maga nem kap belépést; ezt az
Authelia adja a homelab-oldalon.

## Következmények

- **SIGTERM-kezelés.** `docker stop` futás közben ugyanúgy zárja le a futást,
  mint a Ctrl+C (`run:ended` `interrupted: true`, riport, kilépés 130-cal); a
  tétlen `serve` 143-mal lép ki. Mérve: a leállás 10 mp alatt végez, ezért
  `stop_grace_period` nem kell. Ismert korlát: ha a `serve` kapuja foglalt, de
  még nincs futás (felirat-letöltés, `notes`), a SIGTERM-et senki nem kezeli.
- **Futás élése (megoldva, [#351](https://github.com/pcsontos/transcript-refinery/issues/351)):**
  a „fut" / „meghalt" döntés eredetileg a `run:started.pid`-ből jött, ami
  konténerek között hamis volt: a `docker exec … refinery run` futás (PID ≠ 1)
  „meghalt"-nak, a `run:ended` nélkül elhalt `serve`-futás (PID 1) örökre
  „fut"-nak látszott. Ma a napló fájlideje dönt: az író 30 mp-enként frissíti,
  90 mp-nél régebbi fájlidő „meghalt". Így a `docker exec`-es futás és az
  újraindult `serve` is helyesen látszik. Spec:
  [2026-11-03-futas-eletjel-spec.md](../plans/2026-11-03-futas-eletjel-spec.md).
- **Abszolút utak:** a web konténerben a konfig relatív `state.path` és `logs.dir`
  értékét az image build-idejű `/src/` gyökeréhez oldja fel, nem a konfig
  mappájához; hiba nélkül üres korpuszt mutat. A konfigban abszolút utat kell adni.
- Spec: [2026-11-02-refinery-web-image-spec.md](../plans/2026-11-02-refinery-web-image-spec.md).
