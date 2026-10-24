# Spec — a fordítás darabolása és a fordítás közben készülő szójegyzék

**Dátum:** 2026-10-23 · **Státusz:** jóváhagyásra vár

Ez a dokumentum a #259 issue tervezéséből készült. Ahol ez a spec nem mond mást, a mai viselkedés marad. A #260 (önálló szójegyzék-recept) **nem része**; erről lent, „Nem cél".

## A cél egy mondatban

A hosszú forrásjegyzet fordítása darabokban, sorban fut, minden darab megkapja az addig gyűlt szójegyzéket, a kész darabok bukás után megmaradnak. Minden fordítás (darabolt és nem darabolt is) szójegyzéket készít, ami **videónként és célnyelvenként egy közös fájl** a vaultban; a következő fordítás ebből indul. A rövid jegyzet fordítása továbbra is egy hívásban fut.

## Miért

- Az egyhívásos fordítás hosszú anyagon bukik (#258: egy 44 358 szavas webinár 9 perc 20 másodperces generálása időtúllépéssel; a `clean-hu` kalibrálásnál is időtúllépés).
- A `docs/architecture.md` §4 azért zárta ki a darabolást, mert minden átirat elfért egy kontextusablakban (legfeljebb 22 477 szó). A mai bemenetek hosszabbak.
- A régi fordítási spec (`2026-09-17-forditas-spec.md`) kimondta: darabolás csak mért időtúllépés után, külön issue-ban. A mért eset megvan.
- Darabolva a darabok nem látják egymást, ezért a szakkifejezések fordítása szétcsúszhat („adatfolyam" / „stream"). A szójegyzék ezt előzi meg, nem utólag derül ki.

## A tervezés során hozott döntések

| kérdés | döntés | ok |
|---|---|---|
| Szójegyzék szerepe | **Bemenet is**: a darabok sorban futnak, minden darab promptjába bekerül az addig gyűlt lista, és a kimenetében új párokat ad | A következetesség elő van írva, nem utólag derül ki; a párhuzamosság hiánya olcsó, mert a hívások amúgy is rövidebbek |
| Darab bukása | **A kész darabok megmaradnak**, az újraindítás onnan folytatja | A hosszú futás valódi pénzbe kerül; a megismételt költség érezhető |
| Hová mentjük a kész darabokat | **Új tábla az állapottárban** | Az állapottár már a futások állapotát és a költséget tartja, a konténerben `/data` alatt túléli az újraindítást |
| Bíró | **A teljes, összefűzött dokumentumon fut**, a vázkapu is | A bíró és a kapuk kódja változatlan; a darabhatárokat is látja. A bíró többnyire ki van kapcsolva (`skipJudge`) |
| Küszöb | **Config-kulcs** (`translate.chunkWords`), kezdőérték **8 000 szó** | Mért (`docs/measurements/2026-10-24-forditas-darabolas-kalibralas.md`): a modell hívásonként ~40 ezer kimeneti tokent használ, ezért a nagyobb darab olcsóbb; a 4 000 a költséget kb. megduplázta |
| Vágás helye | **Fejlécnél**: a szakaszokat sorban egy darabba gyűjti a küszöbig; ha egyetlen szakasz hosszabb, **bekezdéshatáron** vág; kódblokk, táblázat, lista közepén soha | Az issue kikötése |
| Szójegyzék kimenete | **Szöveges elválasztóval**, séma nélkül: a darab válasza a fordítás, egy elválasztó sor, majd soronként `forrás \| cél` | Nem minden vázlatmodell tud sémás kimenetet (`minimax-m3`); így bármelyikkel működik |
| Szójegyzék fájlja | **`_glossary-hu.md`** (célnyelvenként: `_glossary-de.md`), **videónként és célnyelvenként egy**, nem receptenként; Markdown-táblázat, a fordítások mellett a vaultban, a vault-commit része | Emberi szemmel olvasható, később szótárként beolvasható; a recept nem számít a kifejezések fordításánál |
| Áthelyezés a vaultban | **Követő sor** az `artifacts` táblában (`glossary-<cél>` fajta), a frontmatterben **`kind: glossary-<cél>`**; a mappakövetés (`relink`) ugyanúgy átírja az útját, mint a recepteké, átnevezés után is | A szójegyzékek később egy közös mappába kerülhetnek (döntés: 2026-10-23, a terv átnézésekor) |
| Meglévő szójegyzék | **A következő fordítás ebből indul és bővíti**, akár más recept készítette | A két fordítás szakkifejezései egységesek maradnak; nincs ütközésfeloldás |
| Mikor készül | **Minden fordításnál**, darabolt és nem darabolt esetben is | Egységes viselkedés, a rövid fordítás is gyarapítja a közös szójegyzéket |

## A működés

### Mikor darabol

A fordítás bemenete a forrásjegyzet törzse (`translate.ts`: `transcript`). Ha ennek szószáma **legfeljebb** a `translate.chunkWords`, egyetlen hívás fut, egyetlen darabbal: nincs tábla-írás (a `translation_chunks` táblát nem érinti), de a szójegyzék ugyanúgy bemenet és kimenet. Fölötte a darabolt út fut.

A `translate.chunkWords` pozitív egész, a `TranslateSchema` (`src/config.ts:66`) kapja; alapértelmezése 8 000.

### A darabolás

Egy tiszta függvény: a törzsből darabok listáját adja. Tulajdonságai:
- A darabok összefűzve (`\n\n`-nel) visszaadják az eredeti törzset.
- Fejlécnél (`#`…`######` sor kódkerítésen kívül) vág; a szakaszokat sorban gyűjti egy darabba, amíg a szószám a küszöb alatt marad. Egy darab a küszöböt csak akkor lépheti túl, ha egyetlen oszthatatlan egység (lent) hosszabb nála.
- Ha egy szakasz önmagában hosszabb a küszöbnél, bekezdéshatáron (üres sor) vág.
- **Oszthatatlan egység:** kódkerítés (``` vagy ~~~, a Mermaid is), táblázat (egymást követő `|` sorok), lista (összefüggő lista-elemek, a beágyazott tartalmukkal). Ezek közepén nem vág.
- A fejlécek `source.headingsAreContent` jelzése (kártyás forrás) a vázkapuhoz tartozik, a vágást nem érinti.

### Egy darab fordítása

Minden darab egy modellhívás a recept szerepén (`draft`). A prompt a mai szabályokat (`rules(target)`) és a darab szövegét kapja, a mai „Treat each such term the same way throughout" szabály mellé:
- a **szójegyzék eddigi állása** (`forrás | cél` sorok). Kezdőértéke a vaultban már meglévő `_glossary-<cél>.md` tartalma (ha van), különben üres; a darabolt úton a következő darabok az előzőek utáni állást kapják,
- az utasítás, hogy az ott szereplő kifejezéseket ugyanígy kell fordítani, és a fordítás végén, egy rögzített elválasztó sor után **az ebben a darabban újonnan előfordult** kifejezéspárokat kell felsorolni, köztük azokat is, amelyek angolul maradnak (`forrás | forrás`).

A válasz két részre bomlik az elválasztó mentén. Az elválasztó egy egyedi, fordításban magától nem előforduló sor (a pontos szöveg a végrehajtóé, de **nem `---`**, mert az Markdown vízszintes vonal).

**Hibás válasz** (hiányzó vagy többszörös elválasztó, a `|`-t tartalmazó, de nem két cellás szójegyzéksor, üres fordítás): a darab hibásnak számít és legfeljebb kétszer újragenerálódik; ha utána is hibás, a darab bukik (lásd „Bukás és folytatás").

**Zaj, nem hiba** (az Opus-review nyomán, a kalibrálás előtt): az elválasztó alatt a `|` nélküli sor (pl. `(none)`), a Markdown-tábla elválasztósora és a visszhangozott fejléc (`source term | …`) kimarad, a sor elején álló `- ` vagy `* ` jel lekerül. A prompt is kéri, hogy a modell csak `forrás | cél` sorokat írjon.

**Összefésülés:** a darab új párjait a futás a szójegyzékhez adja, kis-nagybetűtől függetlenül. Ha a forráskifejezés már szerepel, **az első fordítás marad** (a következetesség azt jelenti, hogy nem írjuk felül). A prompt nem kap korlátot a lista hosszára; ha a kalibrálás szerint a lista nő akkorára, hogy gond lesz, az külön döntés.

### Az idő és a költség

- **A recept órája darabonként indul.** A mai 25 perces recept-időkorlát (`DEFAULT_RECIPE_TIMEOUT_MINUTES`, `src/model/deadline.ts`) a teljes recepté; darabolva a teljes futás könnyen meghaladná. Ezért minden darab saját órát kap (ugyanaz az érték, az élő követés életjelével együtt), az összefűzés utáni pontozásnak pedig újat.
- **A költségkeret** (`guard.add`) minden darab hívása után könyvel, a szerepenként, ahogy ma. Az indulás előtti becslés (`outputRatio`) az egész bemenetre vonatkozik, változatlanul.
- **A riport és az `item:refined` esemény** a darabok és a pontozás **együttes** felhasználását mutatja. A darabok generálása a `rounds` egy-egy bejegyzése (a `generateUsage` a darab hívása); a pontozás az utolsóé. A részletes alak a végrehajtóé, de a `RoundTrace` szándékosan **számot visz, szöveget nem** (a vault-tartalom nem szivároghat a riportba): a szójegyzék és a darabok szövege nem kerülhet bele.
- **Folytatásnál** a már kész darabok korábbi költsége a tárban van (tokenek); a `costUsd` a fordítás **teljes** költsége, a költségőr viszont csak az ebben a futásban elköltöttet számolja.

### Összefűzés és kapuk

A kész darabokat `\n\n` választja össze. Az összefűzött szövegen fut a rubrika (`format`, célnyelv, `skeleton`, `translation-faithfulness`) **változatlanul**, a forrás pedig a teljes forrásjegyzet törzse. A `maxIterations: 0` marad: nincs javító kör. Alacsony pontszámnál a jegyzet a mai szabály szerint kiíródik a hiánylistával.

### A szójegyzékfájl

- Neve: `_glossary-<célnyelv>.md` (pl. `_glossary-de.md`), ugyanabban a mappában, ahová a videó jegyzetei kerülnek (`noteFile`, ugyanaz az elhelyezés). A recept azonosítója nincs benne: egy videó + egy célnyelv = egy fájl.
- Tartalma: Markdown-táblázat `forrás` és `cél` oszloppal, a gyűlés sorrendjében. Frontmatterét a végrehajtó a `renderRecipeNote` mintájára állítja össze (a vault pre-commit hookja bélyegez, lásd lent); benne van az `item_id` és a `kind: glossary-<cél>`, mert a mappakövetés ezekből ismeri fel.
- **Minden fordításnál** készül vagy bővül, a darabolt és a nem darabolt úton is. A futás elején a fájlból **csak a `| forrás | cél |` alakú sorokat** olvassa (a fejlécet és az elválasztó sort kihagyva); minden más sor (próza, címsor, üres sor) számára nem létezik. A bővítéskor az új párok a tábla végére kerülnek, **a fájl többi részét a futás nem írja újra**, tehát a kézzel írt szöveg megmarad. Ha a fájlban nincs tábla, a futás a végére fűz egyet.
- Az a táblázatsor, amelyben a `|` miatt nem dönthető el, melyik a forrás és melyik a cél, kimarad a bemenetből, és a futás figyelmeztet. A fájlt ilyenkor sem írja felül üresre.
- A fordítással **együtt** íródik ki, és `done` sort kap az `artifacts` táblában `glossary-<cél>` fajtával, a fájl útjával. A pipeline kiírt fájljaként (commit-módban) ugyanezzel a commitra várók közé is bekerül (`pending_commits`, `src/state/db.ts`), különben kimaradna a vault-commitból. Vault-commit pathspec-kel történik.
- **Hol keresi a futás:** a rögzített úton, ha van sor; különben a jegyzetek mappájában (`noteFile`). Ha a rögzített helyen nincs fájl, ott hoz létre újat.
- **Áthelyezés:** a vaulton belül mozgatott vagy átnevezett szójegyzéket a mappakövetés (`src/vault/relink.ts`) az `item_id` és a `kind` frontmatter-mező alapján megtalálja, és átírja a rögzített utat, mint a recepteknél. A követés kulcsa (`noteKey`) ezért a `recipe` után a `kind` mezőt is nézi, és csak ezek hiányában a fájlnevet.
- **A jegyzetek mappáját nem befolyásolja:** az elem rögzített mappája (`noteDirOf`) a `glossary-*` sorokat nem veszi figyelembe, így egy közös szójegyzék-mappa nem húzza magával az elem többi jegyzetét.
- A write-once szabály (`pipeline.ts:220`) a **fordítás** fájlján dönt: ha az létezik, a futás kihagy, a szójegyzékhez nem nyúl. `--force` a fordítást újragenerálja, a szójegyzék viszont **megmarad és bővül**, nem íródik felül üresre.
- Nem recept: az `artifacts`-sora csak a követést és a commitot szolgálja. A felület, a `list`, a riportok, az áttekintés és a queue a recept-regiszter típusain megy végig (`artifactKinds(registry)`), ezért a receptek között nem jelenik meg; a serve `/notes` listájában viszont igen (a jegyzetekkel együtt, `kind: glossary-<cél>`); költsége üres, a teljes költség összegét nem változtatja.

### Bukás és folytatás

Új tábla az állapottárban, darabonként egy sor:

`translation_chunks(item_id, kind, chunk_index, source_hash, output, glossary_after, input_tokens, output_tokens, created_at)`, elsődleges kulcs: `(item_id, kind, chunk_index)`.

- Egy darab kész állapota akkor kerül a táblába, amikor a fordítása és a szójegyzék-bővítése is értelmezhető. A `glossary_after` az addigi teljes szójegyzék (az újraindítás ebből folytatja).
- A `source_hash` a forrásjegyzet törzsének, a `chunkWords` értékének, a **célnyelvnek** és a **draft modell nevének** lenyomata. A prompt szövegének változását nem fedi (ez a szerző döntése): promptcsere után a `--force` kéri az újrageneráláshoz. Újraindításkor az a tárolt darab érvényes, amelynek lenyomata egyezik. **Eltérő lenyomatnál az elem összes tárolt darabja törlődik, és a fordítás elölről indul**: ha a forrás vagy a küszöb változott, a darabhatárok mások.
- Újraindításkor a folytatás az első hiányzó darabbal kezdődik, a legutolsó tárolt `glossary_after`-rel.
- Ha egy darab az újrapróbálások után is bukik, az elem hibás (mint ma egy bukó fordítás), a kész darabok a táblában maradnak.
- **Siker után** az elem darabjai törlődnek a táblából. Siker = a fordítás és a szójegyzék **kiíródott**, akkor is, ha a kapuk alacsony pontszámot adtak (szerzői döntés): a write-once szabály úgyis megakadályozza az újrafutást, `--force` pedig a darabokat törölné. Ha az összefűzés utáni lépés hibával áll le (a kiírás előtt), a darabok megmaradnak.
- `--force`: törli az elem tárolt darabjait, és mindent újragenerál.
- `dryRun`: semmit nem ír a táblába.

A séma az állapottár `CREATE TABLE IF NOT EXISTS` mintáját követi (új tábla, nem migráció). A leírása a `src/state/db.ts` sémakommentjeit kövesse.

## Nem cél

- **A `clean-*` receptek (köztük a `clean-deep`) darabolása.** A bemenetük fejléc nélküli nyers leirat, és a hűségkapu (#173) a teljes szöveg hosszarányát méri. Külön kérdés.
- **A #258 feladata** (5 perces fejléc-időkorlát, elhagyott hívás): kész, nem ennek a szeletnek a része.
- **A #260**: az önálló szójegyzék-recept még nem tiszta, nem kerül ebbe a specbe. A szójegyzék formátuma (két oszlop, `forrás | cél`) olyan egyszerű, hogy egy későbbi recept használhatja, de erre most nem készül semmi.
- **A szójegyzék átvitele egy másik videóra** (ugyanannak a sorozatnak a következő videója). A szójegyzék videónként van; a videók közötti megosztás új döntés.
- **Darabonkénti kapu vagy darabonkénti javító kör.** A kapuk csak az összefűzött egészen futnak.
- **Párhuzamos darabfordítás.** A sorban futás a döntés lényege.
- **Egyszerre futó, ugyanazon videó- és célnyelvű fordítások** közötti zárolás. A szójegyzékfájl olvasás–bővítés–írás ciklusa nem kezel egyidejű írót (ponytail-korlát; a végrehajtó ellenőrzi, hogy a `run` valóban sorban dolgozza fel az egy elemhez tartozó recepteket).
- **Webes felület vagy Telegram változás.**

## Kalibrálás

A szelet végén, **külön jóváhagyással**, mert valódi pénzbe kerül. Tárgya a `zgWUhE6HjrI` jegyzetének fordítása, és ezt kell megmérni:
- a darabolt fordítás lefut-e, és átmegy-e a vázkapun (a mai tapasztalat szerint a vázkapu a hosszú fordításokat 0 pontra viszi, lásd `2026-09-17-forditas-kalibralas.md`; ezt a #42 külön kezeli);
- a 8 000 szavas küszöb jó-e, és mekkora lesz a szójegyzék;
- a bíró (ha be van kapcsolva) bemenete az egész dokumentumnál elfér-e, és nem fut-e időtúllépésbe;
- a tényleges költség a `/key/info` szerint.

A költésnél a mérési fegyelem érvényes: a becslésre legalább kétszeres ráhagyás, és a hosszú futás előtt már működik a folytatás (ezért a tábla a kalibrálás előtt kész).

## Elfogadási feltétel

1. Egy hosszú forrásjegyzet (pl. a `zgWUhE6HjrI` jegyzete) fordítása darabolva sikeresen lefut, és átmegy a meglévő vázkapun és a hűségbírón (ha be van kapcsolva).
2. A fordítás mellett megjelenik a `_glossary-<cél>.md` fájl, és a benne szereplő kifejezések a fordításban egységesen fordulnak elő.
3. Rövid jegyzet fordítása egy hívásban fut, tábla-írás nélkül, de szójegyzéket ad és olvas. Egy videó két fordítása (pl. `clean-de` és `summary-de`) egyetlen `_glossary-de.md`-t használ, a második az elsőéből indul.
4. Ha egy darab bukik, az újraindítás nem fordítja le újra a kész darabokat; ha a forrás megváltozott, elölről indul.
5. A költségkeret és a riport a darabok együttes felhasználását mutatja.

## Amit a végrehajtó dönt

- Az elválasztó sor pontos szövege és a szójegyzéksorok értelmezése (pl. a `|` jel a kifejezésben).
- A promptok pontos szövege, a szójegyzék formázása a promptban.
- A `RoundTrace` pontos alakja darabolt futásnál.
- Az esemény, amellyel az élő követés a darabok előrehaladását mutatja (a mai `item:generating` újrahasznosítható, ha a jelentése nem hamis).
- A tábla pontos oszlop- és típusválasztása, az indexek.
- A szójegyzékfájl frontmatterének mezői, ha a vault pre-commit hookja egy mezőt másképp bélyegezne.

## Kockázatok és ellenőrzendők

- A **vázkapu** hosszú fordításon 0 pontot adott a kalibrálásnál (bekezdés-/fejlécszám-csúszás). Darabolva ez nem feltétlenül jobb; a #42 kezeli a tűrését. Ha a kalibrálás szerint a darabolt fordítás is a kapun akad, az külön lépés, nem ennek a szeletnek a bukása.
- A szójegyzék-lista a prompton belül darabról darabra nő, és a következő fordítások bemenete is hosszabb; ez a bemeneti költséget is növeli. Nagy közös szójegyzéknél ez a rövid fordításokat is megdrágíthatja.
- A rövid fordítás kimenete eddig tiszta fordítás volt; most elválasztót és kifejezéslistát is kér, ami a kimeneti arányt (`outputRatio`, 5,68) kissé emelheti. A kalibrálásnál ellenőrzendő.
- Az első darab szójegyzéke üres, tehát az ott dőlnek el az első fordítási döntések. Az első darab minősége ezért jobban számít.
