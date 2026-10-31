Spec — `refinery deploy`: szűrés (tétel, fajta, csatorna/forrás) és `--dry-run`

**Dátum:** 2026-10-31 · **Státusz:** tervezet

Ez a dokumentum a #340 tervezéséből készült (szülő: #280). A jegy leírása az alap; ahol ez a spec eltér tőle vagy pontosítja, ez érvényes. A #277 (`docs/plans/2026-10-24-refinery-deploy-spec.md`) és a #278 (`docs/plans/2026-10-30-llm-mdx-spec.md`) döntései változatlanok.

## A cél egy mondatban

A kézi `refinery deploy` szűkíthető legyen néhány tételre (és azokon belül fajtára), és egy `--dry-run`-nal előre megnézhető legyen, mit tenne — úgy, hogy a teljes vault ne menjen át egyszerre a modellen.

## Miért

- A #278 után az első teljes deploy az egész vaultot átalakítaná a modellel (mérés szerint kb. 23–33 USD). Ma nem lehet csak néhány jegyzetet kiküldeni.
- **A valódi helyzet (a felhasználó leírása):** a showroom főoldaláról olvas egy jegyzetet, és látja, hogy nem elég tagolt. Cím alapján megkeresi a vaultban a markdownt, a frontmatterből kimásolja az `item_id`-t, és csak azt a tételt akarja átalakíttatni és kiküldeni. Ez visszatérő, alkalmi mozdulat („amelyiket éppen még egyszer át szeretném olvasni"), nem egyszeri kísérlet.
- Eddig minden ilyen oldal fallback volt (`mdx_fallback: true`, még nem ment át a modellen). A deploy-klónban (2026-10-31) 237 oldalból 217 fallback; ezekre a mai döntési logika (`src/deploy/deploy.ts:164-170`) egy szűrt futásban is újra átalakít.
- **Újragenerálás (a felhasználó kérése, 2026-10-31):** ha egy oldal már átment a modellen, de nem tetszik az eredmény, az `--item x` generálja újra — akár más modellel (`--model`, vagy a config `model.recipes.mdx` sorának átírása).
- Később, ha a felhasználó begyakorolta, egyszerre több tételt is küldene — ehhez a vesszős `--item` lista és a csatorna-/forrásszűrés.

## Anti-cél

- **Szűrt futás, amely a szűrőn kívüli tételt átalakítja, újraírja vagy rá modellt hív.** A szűrés lényege a költség és a kockázat szűkítése. (A korábbi futások függő munkájának véglegesítése nem ilyen, lásd lent.)
- **Szárazfutás, amely bármit módosít** (vault, klón munkafája, commitok, push) **vagy modellt hív.**
- **Szárazfutás, amelynek a listája mást mond, mint az azonnal utána indított éles futás.** Ha nem lehet megbízni benne, nincs értelme.
- Csendben nulla tétel egy elgépelt id vagy fajtanév miatt.

## A tervezés során hozott döntések

| kérdés | döntés | ok |
|---|---|---|
| Több tétel megadása | `--item` vesszős listát fogad (`--item=a,b,c` és `--item a,b,c`), és többször is megadható (`--item=a,b --item c`); az értékek uniója | Felhasználói döntés |
| `--item` `--kind` nélkül | A tétel **minden** oldala (minden fajta, minden nyelv) | Felhasználói döntés |
| `--item` és a „változatlan" | Az `--item`-mel kiválasztott tétel (a `--kind`-dal szűkített) oldalai **mindig újragenerálódnak**, akkor is, ha a jegyzet `generated_at`-je nem változott és az oldal már LLM-es. A `--kind` nélkül ez a tétel összes LLM-es oldalára modellhívást jelent. | Felhasználói döntés, 2026-10-31 |
| Másik modell az újrageneráláshoz | **`--model <név>`, nem kötelező:** csak erre a futásra felülírja az MDX-átalakítás modelljét (a config `model.recipes.mdx`-ét, hiányában a `draft`-ot). Nélküle a config dönt, mint ma. | Felhasználói döntés, 2026-10-31 |
| `--model` részletei | **Az én döntésem:** bármely kézi deploy-futással használható, nem csak `--item`-mel; önmagában **nem** kényszerít újragenerálást (azt az `--item` teszi). A név a config `pricing:` blokkjában ismert modell kell legyen (a költségplafon és a könyvelés az árával számol); ismeretlen vagy ár nélküli névnél hibakóddal áll meg, a klón érintése előtt. A meglévő felülírás-mechanizmust használja (`withRecipeModels`, `src/model/recipe-model.ts`, a Telegram-modellváltás #292 útja). A jelentés első sora kiírja a használt modellt. | Az én döntésem |
| `--channel` / `--source` kényszerít-e | **Nem** (az én döntésem): `--item` nélkül a mai „csak ami új vagy változott" logika marad, különben egy csatornás futás mindent újra kifizetne. `--item`-mel kombinálva a metszet tételei újragenerálódnak. | Az én döntésem |
| `--item` és az `mdx_failed` | Az `--item` felülírja: az elbukott oldal is újra próbálkozik, `--retry-failed` nélkül is | Az én döntésem |
| `--kind` formája | Ugyanaz, mint az `--item`: vesszős lista és/vagy ismétlés | Felhasználói döntés |
| `--kind` nevei | A site-oldal fajtája, ahogy a célfájl nevében áll (`summary`, `notes`, `qa`, `flashcards`, `bloom`, `clean-mild`, `clean-moderate`, `clean-deep`, `glossary`). A **`clean`** rövid név minden `clean-*` fajtára illeszkedik. Az issue-ban szereplő `clean` önálló fajtaként nem létezik. | Felhasználói döntés (rövid `clean`); a nevek a `variantOf` (`src/deploy/variant.ts`) szerint |
| Nyelv szerinti szűrés | Nincs. A fordítás ugyanazt a fajtanevet kapja, mint az eredeti, így a `--kind summary` a `summary.hu.mdx`-et és a `summary.en.mdx`-et is viszi | Nem kérte; nincs rá eset |
| `--channel` / `--source` | **Bennmarad** ebben a körben, a `refinery list` kapcsolóival azonos névvel és jelentéssel (pontos egyezés, kis- és nagybetű nem számít, mint a `filterRows`-ban, `src/view/list.ts`). **Az én döntésem:** a szűrés a vault-jegyzetek frontmatterének `channel` / `source` mezőjén fut, nem a `list` adatforrásán (`readItems`: forrás-felderítés + helyi állapot-DB). A deploy a vaultból dolgozik, és a peter-mba konténer által feldolgozott tételek a helyi állapot-DB-ben nincsenek benne, így a `list` adatforrásán csendben kiesnének. Egy tétel illeszkedik, ha bármelyik jegyzetének mezője egyezik. | Felhasználói döntés (bennmarad, azonos jelentés); az adatforrás az én döntésem |
| Szűrők kapcsolata | ÉS (metszet) | Issue |
| Költségbecslés a szárazfutásban | **Nincs** dolláros becslés; csak darabszám: hány oldalt írna, ebből hányra hívna modellt | Felhasználói döntés |
| A szárazfutás és a klón | A szárazfutás **csak `git fetch`-et** futtat (a munkafát és a helyi ágat nem módosítja), és a távoli `main` állapotával vet össze, nem a helyi, esetleg elavult munkafával | Felhasználói döntés; a peter-mba konténer is deployol ugyanabba a repóba, így a helyi klón lemaradhat |
| Függő munka szűrt futásban | **Globális marad:** a félbemaradt futás maradék-commitja (`deploy.ts:89-93`) és a még ki nem küldött commitok pusha (`deploy.ts:226`) szűrt futásban is a teljes klónra vonatkozik, ahogy ma. A jelentés külön sorban jelzi, ha ez a szűrőn kívüli tételt érintett. | Felhasználói döntés, 2026-10-31 |
| Változatlan oldalak a listában | Nincs soruk, csak az összesítőben a darabszámuk | Felhasználói döntés |

## A működés

### Kapcsolók

A `refinery deploy` új kapcsolói: `--item`, `--kind`, `--channel`, `--source`, `--model`, `--dry-run`. A meglévők (`--config`, `--retry-failed`) változatlanok, és mind kombinálható egymással. A `--channel`, `--source` és `--dry-run` már létezik a közös `parseArgs`-ban (`src/cli.ts`); a deploynál a `DEPLOY_OPTIONS` fehérlistájára kerülnek, a kapcsolóhiba-üzenet („támogatott: …") az újakat is felsorolja.

### Szűrés

- A kiválasztott tételhalmaz: az `--item` értékei, metszve a `--channel`/`--source` szerint szűrt tételekkel (ha meg vannak adva). Az eredmény a `deployNotes` már meglévő `itemIds` bemenetére megy.
- A `--kind` a tételen belül szűr: csak az a jelölt oldal jön szóba, amelynek a fajtája illeszkedik. A szűrés **az összevetés és a modellhívás előtt** történik, így a kizárt oldalra nem fut modell, és nem kerül a jelentésbe kihagyottként sem.
- **Az én döntésem:** a `--kind` a vault-fajtából is kiszámítható fajtára szűr, azokra a jegyzetekre is, amelyeket a `variantOf` még a fajta megállapítása előtt elutasít (pl. nyelv miatt). A fordításnál a `-<nyelv>` végződés levágva, a `glossary-*` → `glossary`. Így `--kind summary` mellett egy `summary-de` fordítás `kihagyva … nyelv: de` sora látszik, egy `qa` jegyzeté nem.
- Szűrő nélkül a viselkedés a mai (teljes vault).
- **Újragenerálás `--item`-mel:** a kiválasztott oldalakra az „írná-e" döntés mindig igen. Az LLM-es oldal újra a modellen megy át, a kártya újra a kódon, a szójegyzék és az ismeretlen fajta újra escape-elve íródik (ez utóbbi kettő modellhívás nélkül). Ha az új kimenet bájtra azonos a kint lévővel, nincs commit.
- **Az én döntésem — nem rontunk:** ha az újragenerálás egy már LLM-es (nem fallback) oldalon elbukik (a modell kimenete elvetve, hibát dob, vagy a költségplafon miatt kimarad), a kint lévő oldal marad, nem íródik helyette fallback, és nem kap `mdx_failed`-et; a jelentés okkal kiírja. Különben egy elégedetlenség miatti újrapróbálás rosszabb oldalt hagyna kint.
- A költségplafon (`cost_limit_usd`) az újragenerálásra is érvényes.
- A jelentés első sora kiírja az érvényes szűrést (éles futásban és szárazfutásban is), pl. `deploy: szűrés: tétel: SlGRN8jh2RI; fajta: summary`.
- A „csak hozzáad és frissít, nem töröl" elv nem változik. Az `auto` mód (`src/cli.ts`, a `run` után) nem változik, és nem kap új kapcsolót.

### Hibák és üres találat

- **Ismeretlen `--item` id** (nincs ilyen tétel a vaultban): hibaüzenet a hiányzó id-kkal, kilépés hibakóddal, **mielőtt** a klónhoz nyúlna vagy modellt hívna.
- **Ismeretlen `--kind` név:** hibaüzenet az ismert nevek listájával, kilépés hibakóddal, ugyanígy a klón érintése előtt.
- **Semmire nem illeszkedő szűrés** (pl. a csatornán nincs tétel, vagy a tételnek nincs ilyen fajtájú jegyzete): érthető üzenet (a `list` „Nincs a szűrőnek megfelelő elem." mintájára), írás és commit nélkül.

### `--dry-run`

- **Nem ír, nem commitol, nem pushol, nem hív modellt**, és a vaulthoz sem nyúl. A klónon csak `git fetch` fut; a `main` ág ellenőrzése marad.
- **Ugyanaz a döntés, mint élesben:** a jelölt kiválasztása, a fajta-útválasztás (`routeOf`), és az „írná-e" döntés (`changed`) ugyanazzal a kóddal fut, mint az éles futásban. Ehhez a `deployNotes` döntési és írási lépését szét kell választani; a szárazfutás csak a döntési lépést futtatja. Az átalakítás eredményére épülő ágak (pl. a modell kimenetének elvetése, a kártyák bonthatatlansága) a szárazfutásban nem ismertek; az út szerinti teendő jelenik meg.
- **Mivel vet össze:** azzal az állapottal, amelyet az éles futás a `git pull --rebase` után látna — a távoli `main` (fetch után), és ha van, rajta a helyi, még nem pusholt commitok és a félbemaradt futás commitolatlan maradéka. A cél, hogy a lista és az azonnal utána futó éles deploy ugyanazt a halmazt érintse.
- **Soronként** (csak az íródó és a kihagyott oldalak):
  - teendő: `új` / `frissítés` / `újragenerálás` (`--item`-mel kiválasztott, egyébként változatlan oldal) / `kihagyva`;
  - a cél útja (`<tétel>/<fajta>.<nyelv>.mdx`), kihagyásnál a vault-fájl neve, ha nincs cél;
  - az út: `LLM` / `kód` (kártya) / `escape` (szójegyzék, ismeretlen fajta); ha nincs átalakító (nincs `LITELLM_API_KEY` vagy modell-config), az LLM-es oldalnál ez látszik (pl. `fallback, nincs átalakító`);
  - kihagyásnál az ok, ugyanazzal a szöveggel, mint élesben (pl. `nyelv: de`), és `mdx_failed (--retry-failed nélkül)` a korábban elbukott oldalnál. `--retry-failed`-del ezek az oldalak `frissítés`-ként, jelölve látszanak.
  - **Az én döntésem:** ma az éles futás az `mdx_failed` oldalt szó nélkül átlépi (`deploy.ts:170`), a jelentésben nem látszik. Ezentúl az éles jelentés is kihagyottként, ugyanezzel az okkal listázza (a `deployLines` közös a CLI-vel és a serve-naplóval, ott is megjelenik), így a szárazfutás és az éles futás ugyanúgy számol.
- **Összesítő:** hány oldalt írna, ebből hányhoz hívna modellt, hány kihagyva, hány változatlan. Token- és költségsor nincs (nincs modellhívás). Változatlan vaultnál, `--item` nélkül, az összesítő megmondja, hogy nincs mit írni.
- **A költségplafon** (`cost_limit_usd`) a szárazfutásban nem jelezhető előre (a valódi tokenszámtól függ): az éles futás kevesebb oldalt írhat LLM-mel, mint a lista mutat; a kimaradtak a mai módon a következő futásra maradnak. Ezt a `docs/usage.md` is kimondja.

A felhasználóval egyeztetett minta (mintaadatokkal):

```
$ refinery deploy --dry-run --item SlGRN8jh2RI,qyPCVqFUyDo
deploy (szárazfutás): szűrés: tétel: SlGRN8jh2RI, qyPCVqFUyDo
  frissítés  SlGRN8jh2RI/clean-moderate.hu.mdx  LLM
  frissítés  SlGRN8jh2RI/clean-moderate.en.mdx  LLM
  frissítés  SlGRN8jh2RI/summary.en.mdx         LLM
  új         qyPCVqFUyDo/qa.hu.mdx              kód
  új         qyPCVqFUyDo/glossary.hu.mdx        escape
  kihagyva   qyPCVqFUyDo/notes.hu.mdx           mdx_failed (--retry-failed nélkül)
  kihagyva   Boris_Cherny_…_notes-de.md         nyelv: de
deploy (szárazfutás): 5 oldalt írna, ebből 3-hoz hívna modellt; 2 kihagyva, 4 változatlan
```

### Dokumentáció

A `docs/usage.md` 8. fejezete és a `--help` ismeri az új kapcsolókat, a vesszős formát, a rövid `clean`-t, a szárazfutás korlátját (költségplafon).

## Ami a tervre marad (a builder dönti)

- A döntési és az írási lépés szétválasztásának pontos formája a `deployNotes`-ban.
- A távoli állapottal való összevetés módja (pl. a fájlok olvasása `git show origin/main:<út>`-tal, és a helyi, nem pusholt állapot rárakása).
- Az ismert `--kind` nevek forrása (pl. a configban ismert receptnevek + `glossary` + `clean`).
- A sorok pontos oszlopelrendezése és szövegezése (a minta szellemében).
- Hogy az `--item` és a `--kind` más parancsnál hibát adjon-e (a meglévő „közös kapcsoló sem maradhat csendben figyelmen kívül" elv szerint valószínűleg igen).

## Nem cél

- Kényszerített újragenerálás `--item` nélkül (pl. egy teljes csatornára).
- Nyelv szerinti szűrés.
- Dolláros költségbecslés.
- Az `auto` mód módosítása, `--dry-run` az `auto` útra.
- Törlés a showroomból (#282).

## Elfogadási feltétel

Megfigyelhető viselkedésként:

1. `refinery deploy --item <id>` csak az adott tétel oldalait alakítja át, írja és commitolja; más tételre nem hív modellt és nem ír új tartalmat. A jelentés első sora kiírja a szűrést. Ha a klónban egy korábbi futás függő munkája volt (commitolatlan maradék vagy pusholatlan commit), az a mai módon kimegy, és a jelentés külön sorban jelzi.
2. `--item=a,b`, `--item a,b` és `--item=a --item b` ugyanazt a tételhalmazt adja; ugyanez a `--kind`-ra.
3. `--item <id> --kind summary` csak a tétel `summary.*.mdx` oldalait írja (mindkét nyelvet, ha van); `--kind clean` a tétel minden `clean-*` oldalát.
4. `--channel` és `--source` azokat a tételeket választja, amelyeknek valamelyik vault-jegyzetében a mező (kis- és nagybetűtől függetlenül) egyezik; az `--item`-mel kombinálva a metszetet. Egy csak a peter-mba által feldolgozott (a helyi állapot-DB-ben nem szereplő) tétel is kiválasztható.
5. Szűrt éles futásban a modell csak a kiválasztott LLM-es oldalakra hívódik; a jelentett token és költség ezt mutatja (teszt hamis klienssel: a hívások száma = a kiválasztott LLM-es, írandó oldalak száma).
6. Ismeretlen `--item` id vagy `--kind` név hibakóddal és érthető üzenettel áll meg, a klón `git status`-a és commitjai változatlanok, modellhívás nincs. Semmire nem illeszkedő szűrés érthető üzenetet ad, írás nélkül.
7. Egy már LLM-es, változatlan jegyzetű oldalra `refinery deploy --item <id> --kind summary` újra modellt hív, és az új kimenetet írja (teszt hamis klienssel: 1 hívás); ugyanez `--item` nélkül 0 hívás. A configban átírt `model.recipes.mdx` az újragenerálásnál érvényesül.
8. `--model <név>` mellett az MDX-átalakítás a megadott modellel fut (teszt hamis klienssel: a kérés modellje), a költség az ő árával számol, a config változatlan; ismeretlen vagy ár nélküli névnél hibakóddal áll meg, modellhívás és klónérintés nélkül. `--model` nélkül a config modellje fut.
9. Ha az újragenerálás egy LLM-es oldalon elbukik, a kint lévő oldal bájtra változatlan marad, `mdx_fallback`/`mdx_failed` nélkül, és a jelentés kiírja az okot.
10. `refinery deploy --dry-run` után a showroom-klón munkafája, helyi ága és commitjai változatlanok, nincs push, nincs modellhívás, a vault változatlan.
11. Egy szárazfutás listájának íródó oldalai és az azonnal utána futtatott éles `refinery deploy` által írásra kiválasztott oldalak megegyeznek (azonos szűrőkkel, költségplafon nélküli esetben). Változatlan vaultnál, `--item` nélkül, a lista azt mondja, hogy nincs mit írni; `--item`-mel a kiválasztott oldalak `újragenerálás`-ként látszanak.
12. Ha a távoli `main` előrébb jár a helyi klónnál (pl. a peter-mba közben kiküldött egy oldalt), a szárazfutás azt az oldalt változatlannak látja, ahogy az éles futás is a pull után (teszt).
13. A `--dry-run --retry-failed` az `mdx_failed` oldalakat íródóként, jelölve listázza; `--retry-failed` nélkül kihagyottként, okkal — és az éles jelentés is kihagyottként, ugyanezzel az okkal.
14. A `docs/usage.md`, a `--help` és a deploy kapcsolóhiba-üzenete ismeri az új kapcsolókat.
