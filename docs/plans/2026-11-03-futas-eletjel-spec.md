Spec — Futás-életjel a PID-ellenőrzés helyett (#351)

**Dátum:** 2026-11-03 · **Státusz:** tervezet

Ez a dokumentum a #351 brainstormingjából készült (2026-11-03).

## A cél egy mondatban

A webfelület „fut” / „meghalt” kiírása a futás naplófájljának rendszeresen frissített módosítási idejéből jöjjön, ne a `run:started` sorban rögzített PID-ből, hogy konténerek között és konténer-újraindulás után is helyes legyen.

## Miért

- **A felhasználó szavaival:** ma ritkábban futtat `docker exec`-kel, de „az lesz az alap futtatás, amikor már stabil a rendszer”. A `docker exec` a `serve` konténerbe megy (felhasználói megerősítés).
- **A mai hiba két iránya** (ADR 0013, #351 és a záró-review komment):
  1. A `docker exec … refinery run` futás PID-je ≠ 1. A web külön konténerben, saját PID-térben fut, ahol ez a PID nem létezik → a futó futás **„meghalt”**.
  2. A `serve` futásai a `serve` folyamatban futnak, `run:started.pid` = 1. A web PID-terében az 1-es PID a web maga, mindig él → egy `run:ended` nélkül elhalt futás (OOM, `docker kill`, SIGKILL) **örökre „fut”**.
- **Miért nem elég a közös PID-tér** (`pid: "service:…"` a compose-ban): az 1. irányt megoldaná, a 2.-at nem. Egy `run:ended` nélküli serve-futás halála maga a `serve` halála; a konténer újraindul, az új `serve` megint PID 1, a régi futás továbbra is „fut”. A PID újraindításokon át nem azonosít folyamatot. (Gondolatmenet, nem kipróbálva; a döntést nem befolyásolja.)
- **Elfogadható késés:** a felhasználó szerint 1–2 perc, amíg egy elhalt futás „meghalt”-nak látszik.

## Anti-cél

- **A felület ír.** Az ADR 0011 „csak olvas” elve változatlan: a web a fájl idejét csak olvassa (`stat`).
- **Futó futás „meghalt”-nak látszik** normál működésben (pl. hosszú modellhívás közben). Ez rosszabb a mai állapotnál, mert a fő futtatási módot érinti.
- **A napló tartalma változik az életjel miatt.** Az életjel nem ír új sort; a napló eseményfolyam marad, a felület idővonala és az „utolsó esemény óta eltelt idő” nem kap zajt.

## Nem cél

- Compose-változtatás, megosztott PID-tér.
- Konfigurálható életjel-időköz.
- A `run:started.pid` mező eltávolítása az eseményből (a régi naplók olvasásához és diagnosztikához marad).

## Előfeltétel-tények (ellenőrizve a kódban, 2026-11-03)

- **Az állapot-döntés:** `src/run/status.ts:29-46` `runStatus(lines, ctx)`; `run:started` van és `run:ended` nincs → `ctx.isAlive(started.pid) ? 'running' : 'died'`. Az `isPidAlive` (`status.ts:55-62`) `process.kill(pid, 0)`, `EPERM`-re is él.
- **Az `isAlive` hívói:** `src/view/runs.ts` (`loadRun`, `readRuns`, `readRun`), `src/view/overview.ts:176`, `src/view/reports.ts:303`, és a `src/index.ts:56` exportálja a webnek. A web egyetlen közvetlen hívója: `web/server/api/runs/[runId]/events.get.ts:23` (`isAlive: isPidAlive`).
- **Az élő követés** (`src/run/follow.ts`): a `followRunLog` a PID-et a `run:started`-ból veszi (`startedPid`), 500 ms-enként (`intervalMs`) olvas, és ha a folyamat már nem él, még egy utolsó olvasás után befejeződik (`follow.ts:64-90`). PID nélkül (változás előtti napló) vagy lezárt naplónál azonnal kilép.
- **A napló írója:** `src/run/log.ts:20` `openRunLog(path)` — `openSync(path, 'a')`, eseményenként `writeSync`, idempotens `close()`. A `run` parancs `src/cli.ts:597`-nél nyitja, `cli.ts:610`-nél írja a `run:started`-ot, `cli.ts:1046`-nál zárja. A `serve` ugyanezt a kódot hívja (`src/serve/summary.ts`, `commandRun`), így mindkét futtatási mód ugyanazon az úton megy.
- **A meglévő szívverés nem elég:** a `pipeline.ts` `recipeClock` `item:progress` eseményt csak receptfutás közben küld, alapból 10 percenként (`src/model/deadline.ts:6`). Letöltés, normalizálás, tétlen szakaszok alatt nincs jel.
- **A peter-mba:** a naplómappa a `${DATA_ROOT}/refinery:/data` bind mount alatt van (homelab compose). A web konténer még nincs telepítve (a homelab-terv végrehajtása hátra van). Hogy a peter-mba-n melyik Docker-futtató fut, és az egyik konténerben frissített fájlidőt a másik konténer `stat`-ja mekkora késéssel látja, **nincs ellenőrizve**.

## A tervezés során hozott döntések

| kérdés | döntés | ki döntött |
|---|---|---|
| PID vagy életjel | **Életjel** a napló módosítási idején | felhasználó (2026-11-03) |
| Elfogadható felismerési késés | 1–2 perc | felhasználó |
| Életjel helye | A napló saját fájlja, új fájl nélkül; csak az idő frissül, tartalom nem | javaslat, a felhasználó jóváhagyta |
| Időköz / küszöb | **30 mp** frissítés, **90 mp** küszöb (legrosszabb eset ≈ 2 perc) | javaslat, a felhasználó jóváhagyta |
| Konfigurálható-e | Nem, rögzített konstans a kódban | javaslat, a felhasználó jóváhagyta |
| `isPidAlive` | Kikerül; a `run:started.pid` mező marad | javaslat, a felhasználó jóváhagyta |
| Téves „meghalt” után | Nem áll vissza magától; oldal-újratöltés után javul. Kliensoldali (Nuxt) munka nincs | javaslat, a felhasználó jóváhagyta |
| Élő mérés és kiadás | A kód-PR és a kiadás nem vár a peter-mba mérésre; a mérés a homelab web-telepítés része. Nagy késésnél először a küszöb emelése | javaslat, a felhasználó jóváhagyta |
| Követés türelmi ideje | A követés ugyanazt a 90 mp-es küszöböt használja, külön türelmi idő nincs | builder-döntés (a spec írójáé) |

## A. Az író: életjel a naplóban

- Az `openRunLog` a nyitáskor elindít egy 30 mp-es időzítőt, amely a nyitott fájlleírón frissíti a módosítási időt (pl. `futimesSync(fd, now, now)`). Az időzítő ne tartsa életben a folyamatot (`unref()`), a `close()` állítsa le.
- Az eseményírás (`writeSync`) magától is frissíti a módosítási időt; ez rendben van.
- A frissítés hibája (pl. eltűnt fájl) ne döntse el a futást; némán elnyelhető.

## B. Az olvasó: állapot a fájl idejéből

- A `runStatus` döntése változatlan szerkezetű marad, csak az „él-e” forrása más: `run:started` van, `run:ended` nincs → **„fut”**, ha a napló módosítási ideje legfeljebb 90 mp-cel régebbi a mostani időnél, különben **„meghalt”**.
- Ugyanez a szabály érvényes a futáslistára, a futás oldalára, az áttekintésre és a riport-nézetre (minden `readRuns`/`readRun`/`loadRun` hívó), és az élő követésre.
- **Élő követés:** a `followRunLog` PID helyett a fájl idejével dönti el, hogy az író még él-e; elhalt írónál a mai módon egy utolsó olvasás után befejeződik. A „PID nélküli napló → azonnali kilépés” helyett a feltétel: nincs `run:started` (változás előtti napló) vagy lezárt.
- A mostani időt és a fájlidőt a tesztek tudják vezérelni (beinjektált óra / stat), ahogy ma az `isAlive` hamis függvény.
- A web oldali `events.get.ts` és az `index.ts` export ehhez igazodik; az `isPidAlive` export megszűnik.

## C. Dokumentáció

- ADR 0013 „Ismert korlát” és „Fordított hiba” pontja: megoldva, hivatkozással erre a specre és a kód-PR-re.
- A `status.ts` „újrahasznosított pid” megjegyzése megszűnik; helyette az új korlát (lásd Kockázatok).

## Kockázatok és ismert korlátok

- **Blokkolt eseményhurok:** ha a futó folyamat eseményhurka 90 mp-nél tovább szinkron műveletben áll, a futás „meghalt”-nak látszik. A futás oldalán az élő követés ilyenkor véget ér (a szerver `end`-et küld, a `useRunStream` bezárja a kapcsolatot), és nem indul újra magától; oldal-újratöltés után a felület az életjel alapján megint „fut”-ot mutat és újra követ. A lista és az áttekintés amúgy is csak újratöltéskor frissül. Ma nem tudunk ilyen hosszú szinkron szakaszról; nincs mérve.
- **Átállás:** a frissítés előtti verzióval induló, épp futó futás nem küld életjelet, így az új web 90 mp tétlenség után „meghalt”-nak mutatja. Egyszeri, átmeneti; elfogadható.
- **Fájlidő konténerek között:** lásd az Elfogadás élő próbáját; ha a bind mount gyorsítótárazás miatt a web késve látja a frissítést, első lépésként a küszöb emelése; más megoldás csak akkor, ha ez sem elég.

## Elfogadási feltételek

1. **Egységtesztek** (beinjektált órával): `run:ended` nélküli napló 89 mp-es fájlidővel → „fut”; 91 mp-essel → „meghalt”; `run:ended`-del a fájlidőtől függetlenül a mai lezárt állapotok; változás előtti napló (nincs `run:started`) a mai módon.
2. **Az író teszte:** nyitott `openRunLog` mellett az időzítő a fájl idejét előre viszi esemény nélkül is, és `close()` után nem.
3. **Élő követés teszte:** elhalt író (fájlidő a küszöbön túl) → a követés egy utolsó olvasás után befejeződik; élő íróval folytatódik.
4. **Élő próba a peter-mba-n**, a homelab web-telepítés részeként. Nem feltétele a kód-PR-nek és a kiadásnak:
   - `docker exec … refinery run` egy hosszabb futással → a felületen végig „fut”, legalább egy 90 mp-nél hosszabb esemény nélküli szakaszon át is.
   - Futás közben a konténeren belüli folyamat leölése: `docker exec <serve> kill -9 <pid>` a `docker exec`-es futásra, illetve `docker kill` a `serve` konténerre a serve-futásnál. (A host-oldali `docker exec` kliens leölése nem öli meg a konténerben futó folyamatot.) → oldal-újratöltés után legkésőbb ~2 perccel a felület „meghalt”-ot mutat, és a `serve` újraindulása után sem vált vissza „fut”-ra.
   - Mérve: a web konténerből nézett fájlidő a frissítéshez képest mennyit késik.

## Ami a tervre marad

- A pontos függvény-aláírások (pl. `isAlive(pid)` helyett `mtime`-ot vagy fájlutat kapó függvény), és hogy a `stat` hol történik (`listRuns`-ban vagy `loadRun`-ban).
- A konstansok neve és helye.
- A tesztek pontos szerkezete a meglévő `status`/`follow`/`log` tesztek mintájára.
