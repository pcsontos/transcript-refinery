# Változásnapló

A projekt verziói a [szemantikus verziózást](https://semver.org/lang/hu/)
követik. Minden spec megvalósítása után új kiadás készül.

## [1.1.0] — 2026-09-23

A feldolgozási sor (`_queue.md`) Obsidianban számozott, összecsukható
vázlat lett: csoport → videó → recept → fordítás. Az első `scan --queue`
a korábbi sort magától átalakítja, a pipák és az eredmények megmaradnak.

### 🗂️ Feldolgozási sor

- **Számozott vázlat:** forrásmappánként egy számozott `##` fejléc, alatta
  videónként egy számozott `###` fejléc, és receptenként egy pipa. A
  sorszámokat minden scan újraszámolja, így kézi törlés vagy átrendezés
  után is folytonosak.
- **A fordítás a forrása alatt:** behúzott nyelvi al-sorként áll a
  forrásreceptje alatt (`- [x] summary` alatt `  - [ ] hu`), és a szülővel
  együtt összecsukható. A bepipált fordítás továbbra is a `summary-hu`
  párt indítja; a pontszám, a költség és a link az al-sorra íródik vissza,
  a szülő recept sora érintetlen marad.
- **Célnyelvű videó alatt nincs fordítássor:** egy magyar videó alatt nincs
  `hu` pipa, amit feleslegesen ki lehetne pipálni. Ha ott már áll ilyen
  sor, a scan törli — a bepipáltat is —, és a konzolon kiírja, hányat. A
  vaultbeli jegyzetfájlhoz nem nyúl, csak a sorhoz.
- **Nyelvkód nélküli felirat:** ha a fájlnévben nincs nyelvkód, a scan a
  felirat szövegéből ismeri fel a nyelvet (modellhívás és költség nélkül).
  Ha a nyelv nem ismerhető fel biztosan, a fordítássorok megmaradnak.
- **Saját szakaszok védve:** a sor végére írt saját fejléc (például
  `## Jegyzetek`) a csoportok határa: alá a scan nem szúr be új videót vagy
  receptet, és a saját sorokat továbbra is bájtra érintetlenül hagyja.

### 🔄 Átállás a régi formátumról

- Az első `scan --queue` egyszer átalakítja a korábbi, lapos formátumú
  sort, a pipákkal, a pontszámokkal, a költségekkel és a linkekkel együtt.
  A második futás már nem változtat semmit.
- A `run --queue` régi formátumú sorra hibával megáll, és a
  `scan --queue`-t javasolja — nem dolgoz fel csendben nulla párt.

## [1.0.0] — 2026-09-23

Az első kiadás: a v1 architektúra (Fázis 0–6 és az üzemeltetési javítások)
teljes állapota. A korábbi munka kiadás nélkül, a `0.1.0` verzión futott;
ez a bejegyzés az egészet összefoglalja.

### ✨ Feldolgozás

- **Feliratból tiszta átirat, modell nélkül:** SRT és VTT beolvasás,
  ismétlődések kiszűrése, bekezdésekre tördelés és írásjel-sűrűségi
  minőségkapu, ami kiszűri a gépi feliratokat.
- **Forrásfüggetlen bemenet:** bármilyen mappából dolgozik, ahol `.srt` vagy
  `.vtt` fájl van; a metaadat (`.info.json`) opcionális, több forrásmappa is
  megadható.
- **Nyelvfelismerés:** ha a fájlnévben nincs nyelvkód, a felirat szövege
  dönt a nyelvről.
- **Köteges futás folytathatóan:** SQLite állapottár, a megszakított futás
  onnan folytatódik, ahol abbamaradt; a hibás elemek `--retry-failed`-del
  újrafuttathatók.

### 📝 Receptek

Hét jegyzettípus, mindegyik saját kiértékelő rubrikával:

- **`summary`** — összefoglaló.
- **`flashcards`** — tanulókártyák Decks-formátumban.
- **`qa`** — kérdés-felelet.
- **`clean`** — tisztított leirat bekezdésenkénti időbélyegekkel.
- **`bloom`** — Bloom-taxonómia szerint szintezett kártyák.
- **`notes`** — strukturált jegyzet.
- **Fordítás** — bármelyik recept kész jegyzetének célnyelvű változata
  (`clean-hu`, `summary-hu` …), a konfigban megadott receptekre.

### ✅ Minőségkapuk

- **Bíró és kapuk:** hűség- és lefedettség-bíró, determinisztikus
  formátumkapu, nyelvi kapu, szöveghűség-kapu a tisztított leirathoz,
  célnyelv- és vázkapu a fordításhoz.
- **A bíró kikapcsolható** (`--no-judge` vagy configból), ha csak gyors
  vázlat kell.
- **Csonka modellválasz** (kimeneti limit) hibával áll meg, nem kerül be
  félkész jegyzet.

### 💰 Költség

- **Előzetes becslés és plafon:** a futás előtt látszik a várható költség, a
  `cost_limit_usd` plafon elérésekor a köteg tisztán megáll.
- **`check-pricing`:** összeveti a configban megadott árakat a LiteLLM élő
  áraival; `--fix`-szel vissza is írja őket.

### 🗂️ Obsidian és felület

- **Jegyzetek a vaultba:** frontmatterrel, receptenkénti címkékkel,
  Obsidian-kompatibilis linkekkel; a publikált fájlok automatikus
  git-commitja a vaultban (`--no-commit`-tal kikapcsolható).
- **Feldolgozási sor (`_queue.md`):** a `scan --queue` felveszi a videókat,
  pipával választod ki, mi készüljön, a `run --queue` lefuttatja, és az
  eredményt (pontszám, költség, link) visszaírja a sorba.
- **Webes felület (Nuxt):** áttekintés, elemek, hibák és futások, élő
  követéssel.

### 📊 Napló és riport

- **Futásnapló** JSONL-ben és részletes konzolkimenettel.
- **Markdown riport** futásonként: korpusz-állapot, sor-állapot,
  figyelmeztetések, a fejlécben helyi idővel.
- **Súgó:** `--help` / `-h` a parancsok és kapcsolók listájával.

### 🐛 Javítások

- A megszakított futás elmaradt vault-commitja a következő futáskor pótlódik.
- A horgonyzás hibája bekezdésenként esik vissza, nem dobja el a teljes
  jegyzetet.
- A bíró tokenjei a bíró árán könyvelődnek.
- A CLI szimlinkelt `bin`-ből indítva is működik.
- A frontmatter címkéiben aláhúzás áll a szóköz helyett.

[1.1.0]: https://github.com/pcsontos/transcript-refinery/releases/tag/v1.1.0
[1.0.0]: https://github.com/pcsontos/transcript-refinery/releases/tag/v1.0.0
