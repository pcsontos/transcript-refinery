# Spec — A második szelet: summary a vaultba

**Dátum:** 2026-10-05 · **Státusz:** jóváhagyva, az implementációs terv a [`2026-10-05-telegram-summary.md`](./2026-10-05-telegram-summary.md) fájlban van

Ez a dokumentum a [`2026-10-04-telegram-cloudflare-brief.md`](./2026-10-04-telegram-cloudflare-brief.md) második szeletéből és a jóváhagyott tervezésből készült. Az első szelet spece a [`2026-10-04-telegram-cloudflare-spec.md`](./2026-10-04-telegram-cloudflare-spec.md). Ez a fájl csak a második szeletet írja le. Az első szelet viselkedése marad, ahol ez a spec nem mond mást.

## A cél egy mondatban

A saját chat YouTube-címe továbbra is az R2-be teszi a feliratot. A kész üzenet `summary` gombjára a konténer a meglévő `summary` receptet futtatja, a `_summary.md` a vaultba kerül, és a bot a jegyzet GitHub-linkjét küldi.

## Ezen a szeleten kívül

A többi recept, a többgombos választó, az olvasó oldal, a Google-kötés, a lejátszási lista, a `_queue.md`, és a fiókonkénti költségplafon. A mostani futás költségőre erre az egy videóra érvényes. A bot a vault sorába nem ír.

## 1. A darabok

A Worker ajtó marad. A `refinery serve` a felirat-lépésben a mai fetch-utat futtatja, és a csővezetéket nem nyitja meg. A summary lépésben ugyanaz a folyamat az R2-ből olvas, a meglévő csővezetéket erre az egy videóra futtatja, és a vaultba commitol.

```text
Telegram --webhook--> Worker (D1, cron)
                         |  kopogtat, recept nélkül
                         v
                    refinery serve
                     fetch → R2
                         |  visszahívás: cím
                         v
                    Worker → „A felirat megvan.” + summary gomb
                         |  koppintás
                         v
                    refinery serve, recipe: summary
                     R2 → egy videó, summary → vault
                         |  visszahívás: GitHub-link
                         v
                    Worker → „A jegyzet megvan.”
```

| Darab | Mit birtokol |
|---|---|
| Worker | A gomb, a második kopogtatás, mindkét kész üzenet. A D1 a bot nyoma: a felirat állapota, a fázis, és hogy a jegyzetet kérték-e, a link kiment-e. |
| `refinery serve` | Ugyanaz a `POST /jobs`, egyszerre egy munka. Recept nélkül a mai fetch. `recipe: "summary"` mellett az R2-ből olvas, a csővezetéket futtatja, commitol és pushol. |
| R2 | Felirat és `info.json`. Markdown nincs benne. |
| Vault | A `_summary.md`, és ha még nincs meg, a `_transcript.md` is. Write-once. |
| LiteLLM | A konténer környezetének `LITELLM_API_KEY` értéke, csak a summary lépésben. |
| SQLite | A config `state.path` állománya a konténer volume-ján. A summary lépés nyitja. |

A summary egy hatás, ugyanúgy, ahogy a fetch-út ma. A munka futtatója eldönti, hogy a hatás hívódik-e, és a hatás eredményét visszahívja. A hatás a csővezetéket, a vault gitet és a link összerakását birtokolja.

## 2. A kérés útja

A puszta YouTube-cím az első szelet útja. A kész üzenet mondata marad: `<cím>. A felirat megvan.` Mellette egy gomb van. A gomb felirata `summary`, az adata `summary:<jobId>`. Az üzenet szövegében álló `summary` szó továbbra sem munka. A gomb csak ezen a kész üzeneten van, így a második kopogtatás akkor indul, amikor az első munka a kaput már elengedte.

A D1 státuszai maradnak: `queued`, `waiting`, `accepted`, `ready`, `failed`. Új mező a `phase`, értéke `subtitle` vagy `summary`. A meglévő sorok `subtitle` fázisban maradnak.

| Oszlop | Jelentés |
|---|---|
| `phase` | `subtitle` vagy `summary`. Alapérték: `subtitle`. |
| `note_url` | A GitHub-link, amint a konténer megadta. |
| `note_notified` | A linküzenet kiment-e. Alapérték: nem. |

A `ready` sort a cron nem ébreszti. A `queued`, a `waiting` és az `accepted` sort ébreszti, a mai tizenöt perces szabállyal. A kopogtatás a fázist viszi. Summary fázisban a test `recipe` mezője `summary`. Felirat fázisban a test a mai `{ jobId, videoId, url }`.

A gomb csak `phase = subtitle` és `status = ready` sorból indítja a summaryt. A váltás egy feltételes írás: csak az a koppintás nyer, amelyik a sort még ebben az állapotban találja. A nyertes írás `phase = summary` és `status = queued` lesz, `error` üres, majd a Worker ugyanazzal a `jobId` értékkel kopogtat. A vesztő koppintás a már nyitott summary szabályát kapja.

Amíg a summary `queued`, `waiting` vagy `accepted`, ugyanarra a videóra érkező új cím `Már sorban van: <videóazonosító>.` A felirat `ready` állapota új címet nem tart fel. Az új sor az R2-készlet miatt YouTube nélkül készül el, és saját gombot kap. A régi gomb a régi soron marad.

A `POST /jobs` a mai test. A summary lépés hozzáteszi: `recipe: "summary"`. Más `recipe` értékre a serve `202` után `failed` visszahívást küld, a mondat `Ismeretlen recept.` A cron a `failed` sort nem ébreszti.

Teljes R2-készletnél a summary lépés a YouTube-ot nem hívja. A készlet az első szelet szabálya. A serve a feliratot és az `info.json` fájlt a `SERVE_OUT` mappába írja, a fetch `--flat` neveivel: `<cím> [<videóazonosító>].<nyelv>.<kiterjesztés>` és `<cím> [<videóazonosító>].info.json`. A cím az `info.json` `title` mezője. Üres címnél a videóazonosító a cím. Ez az egy mappa a forrás. A forrás neve a mappa utolsó útszegmense. Más config-forrás mappát a lépés nem olvas.

A jegyzet a meglévő `noteFile` szabály szerint készül, a config `notes_dir` gyökerébe. Az alap `notes_dir` és a `SERVE_OUT=/data/telegram` mellett az út `Inbox/transcript-refinery/telegram/<alapnév>_summary.md`. Az elem azonosítója a videóazonosító, mert az `info.json` ott van. A recept a meglévő `summary`. Ha a jegyzet már megvan, modellhívás nincs. Ha az átirat még nincs meg, a csővezeték a `_transcript.md` fájlt is kiírja.

A commit csak a futás által írt jegyzetfájlokat tartalmazza. Utána `git push` megy, argumentum nélkül, a vault aktuális ágára. Ha nem volt mit commitolni, új commit nincs, a push lefut.

A `noteUrl` csak akkor megy ki, ha a push sikerült és a link összerakható. A link az `origin` címéből, a vault aktuális ágából és a vaultgyökérhez képesti útból áll: `https://github.com/<tulaj>/<repo>/blob/<ág>/<útvonal>`. Az útvonal szegmensei kódolva vannak, a perjelek maradnak. A `git@github.com:tulaj/repo.git` és a `https://github.com/tulaj/repo.git` cím ugyanazt a blob-linket adja. A `.git` végződés elhagyható. Más alakú `origin` mellett link nincs, a mondat `A vault távoli címe nem GitHub-cím.`

A munkaállomány a visszahívás előtt törlődik, sikeres és hibás lépés után is. A törlés hibája a már eldöntött visszahívást nem cseréli le. A tartós felirat az R2, a jegyzet a vault.

A visszahívás útja a mai. A Worker a sor `phase` mezője szerint olvas.

| Fázis | Kész test | Hibás test |
|---|---|---|
| `subtitle` | `{ status: "ready", title }` | `{ status: "failed", error }` |
| `summary` | `{ status: "ready", title, noteUrl }` | `{ status: "failed", error }` |

Felirat fázisban a `noteUrl` mezőt a Worker figyelmen kívül hagyja. Summary fázisban a link a D1 `note_url` mezőjébe kerül, akkor is, ha a Telegram-küldés hibázik.

A jegyzet kész üzenete két sor, akkor is, ha a fájl már megvolt:

```text
<cím>. A jegyzet megvan.
https://github.com/…/blob/…/_summary.md
```

A küldés sikerére a sor `ready`, a `note_notified` igaz. Ismételt kész visszahívás, ha a linküzenet már kiment, második üzenetet nem küld.

## 3. Hibakezelés

Minden gombkoppintásra a Worker üres `answerCallbackQuery` választ ad, hogy a pörgetés megálljon. Üzenetet és kopogtatást csak a saját chat kap. Idegen chatnél ennyi az egész. Az ismételt `update_id` nem kopogtat és nem üzen, ahogy a sima üzenetnél.

A saját chat koppintása:

| Állapot | Eredmény |
|---|---|
| `subtitle` és `ready` | Summary indul, a 2. szakasz feltételes írásával. |
| Summary nyitott | Nincs második kopogtatás. A mondat: `Már sorban van: <videóazonosító>.` |
| A linküzenet már kiment | Nincs kopogtatás. A két soros kész üzenet újra megy. Ha ez a küldés hibázik, a `note_notified` igaz marad. |
| Summary `failed` | Ugyanaz a gomb újrapróbálja. A fázis `summary` marad, a státusz `queued`, az `error` üres, és megy a kopogtatás. Ezt is feltételes írás dönti el. A vesztő koppintás a nyitott summary mondatát kapja. |
| Minden más | Nincs üzenet, nincs kopogtatás. |

A várakozás mondata mindkét fázisban a mai: `A gép ébredésére vár: <videóazonosító>.` A `409`, a `401` és a `A konténer elutasította a hívást.` mondat a mai. A `401` a sort `failed` állapotba teszi, a fázisát nem váltja vissza.

A Worker a kapott `error` mondatot küldi ki, ahogy az első szeletben. A sor akkor lesz `failed`, amikor ez a küldés sikerül. Ha a küldés hibázik, a sor `accepted` marad, és a cron újra kopogtat.

A summary hiba mondata az, amit a CLI ugyanerre a megállásra kiír, egy sorban. Ahol a CLI hallgat, a mondat ez:

| Eset | Mondat |
|---|---|
| Az R2-készlet hiányzik | `A felirat nincs az R2-ben.` YouTube-hívás nincs, summary hatás nincs. |
| Az R2-ből a készlet nem olvasható, vagy a munkaállomány nem írható | `A felirat nem olvasható az R2-ből.` |
| A `git pull --ff-only` elhasal | `A vault frissítése nem sikerült.` |
| A push elhasal | `A push nem sikerült, a commit lokálisan maradt.` Link nincs. A commit a gépen marad. |
| Az `origin` nem a két GitHub-alak egyike | `A vault távoli címe nem GitHub-cím.` |
| A `recipe` nem `summary` | `Ismeretlen recept.` |

Ha a recept hibázik, de az átirat már a vaultban van, az átirat marad. A visszahívás `failed`. Az újrapróba az átiratot kihagyja, és a summaryt viszi tovább.

Ha a link üzenete az első alkalommal nem megy ki, a sor `accepted` marad, a `note_url` megvan, a `note_notified` hamis. A cron negyedóra múlva újra kopogtat. A második futás write-once. Ha a summary visszahívása `ready`, de `noteUrl` nincs benne, a Worker nem küld linket. A mondat `A jegyzet linkje hiányzik.` A sor ennek a mondatnak a sikeres küldése után `failed`.

## 4. A kód határa

A `worker/` döntései tiszta függvények maradnak. Új függőség nincs. A belépés a `callback_query` frissítést is a döntéshez adja, és az üres gombválaszt a Telegramnak elküldi. A D1 migráció a három oszlopot adja hozzá. A `memoryStore` ugyanezeket a mezőket tartja.

A `src/serve/` kapja a `recipe` mezőt és a summary hatást. A hatás a meglévő csővezetéket hívja, egy forráskönyvtárral, `summary` recepttel, a config vaultjával és a meglévő modellkliens-illesztéssel. A GitHub-link tiszta függvény. Új config-kulcs nincs. A summary lépés a meglévő `refinery.config.yaml` fájlt használja. Ha a fájl vagy a modellbeállítás hiányzik, a CLI hibájának első sora a visszahívás mondata. A felirat-lépés config nélkül is a mai úton marad.

A konténerben a vault a config `vault.path` útján van felcsatolva, és a `LITELLM_API_KEY` a környezetben van. A kulcs nincs a YAML-ben.

## 5. Teszt

A viselkedést a meglévő Vitest fedi, új tesztfüggőség nélkül. Éles Telegram, R2, YouTube, LiteLLM és képépítés nincs a futásban. A felirat-lépés meglévő tesztjei maradnak. A felirat kész tesztje a mai mondat mellé a `summary` gombot várja.

A Worker tesztjei hamis tárral és hamis kopogtatással:

- A felirat `ready` visszahívása a mai mondatot küldi, és egy `summary` gombot ad `summary:<jobId>` adattal. A `ready` videó új felirat-munkát nyithat. Az üzenetben álló `summary` szó nem munka.
- A saját chat koppintása `subtitle` és `ready` sorból `summary` fázisú, `queued` sort csinál, és a kopogtatás viszi a `recipe` mezőt. A második ilyen koppintás, az első írás után, nem kopogtat. Idegen chatnél nincs kopogtatás és nincs üzenet.
- Nyitott summaryre a foglalt mondat megy. Kiment linknél a két soros kész üzenet megy újra, és egy hibás újraküldés a `note_notified` értéket igazon hagyja. `failed` summaryre a gomb `queued` sort és új kopogtatást csinál.
- A cron a summary fázisú nyitott sort `recipe: "summary"` kopogtatással ébreszti. A felirat fázisú ébresztés recept nélkül megy.
- Summary `ready` `noteUrl` nélkül, sikeres mondatküldés után, `failed`, a mondat `A jegyzet linkje hiányzik.` Sikertelen linkküldésnél a sor `accepted` marad, a `note_url` megvan, a `note_notified` hamis.
- A régi sor `phase` értéke `subtitle`. Az ismételt `update_id` nem kopogtat.

A `runJob` tesztjei a fetch-utat, az R2-t és a summary hatást helyettesítik:

- Teljes R2-készlet és `recipe: "summary"`: a fetch nem indul, a hatás igen, a visszahívás `{ status: "ready", title, noteUrl }`, a munkaállomány törlődik.
- Hiányos R2-készlet: a mondat `A felirat nincs az R2-ben.`, fetch és summary hatás nincs.
- Recept nélküli test: a mai fetch.
- Más `recipe`: `failed`, a mondat `Ismeretlen recept.`
- A hatás hibamondata változtatás nélkül a `failed` visszahívás `error` mezője.

A hatás tesztje ideiglenes vaultban, hamis modellklienssel fut:

- Egy feliratból és `info.json` fájlból létrejön a `_transcript.md` és a `_summary.md`. A commit csak ezeket a fájlokat tartalmazza. A link a `_summary.md` fájlra mutat.
- Második futásra modellhívás nincs, a link megmarad.
- A pull hibája `A vault frissítése nem sikerült.`
- A push hibája `A push nem sikerült, a commit lokálisan maradt.`, és link nincs.
- A két GitHub `origin` alak, `.git` végződéssel és anélkül, ugyanazt a blob-linket adja. Más alak a `A vault távoli címe nem GitHub-cím.` mondatot adja, link nélkül.

## Siker

A saját chat YouTube-címet küld. A bot azt írja, hogy a felirat megvan, és ad egy `summary` gombot. A gombra a konténer a jegyzetet a vaultba írja, majd a bot elküldi a GitHub-linket. Ha a jegyzet már a vaultban volt, modellhívás nincs, a link akkor is kimegy. Újabb gombnyomás a kiment link után ugyanazt a két sort küldi, kopogtatás nélkül. Más chat nem megy át. Alvó gépen a summary sora megmarad, és a bot az ébredést mondja.
