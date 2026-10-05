# Spec — Az első szelet: Telegram-felirat az R2-be

**Dátum:** 2026-10-04 · **Státusz:** jóváhagyva, az implementációs terv a [`2026-10-04-telegram-cloudflare.md`](./2026-10-04-telegram-cloudflare.md) fájlban van

Ez a dokumentum a [`2026-10-04-telegram-cloudflare-brief.md`](./2026-10-04-telegram-cloudflare-brief.md) briefből és a jóváhagyott tervezésből készült. Az implementációs terv ebből épül. Csak az első szeletet írja le.

A brief az R2-t nyers `.vtt` tárolónak mondta, és a címet a konténer állapotában hagyta. A tervezés ezt felülírta: az R2 a fetch által kiírt feliratfájlt és az `info.json` fájlt tárolja. A fetch alapértelmezése `vtt/srt`, nyelvenként egy fájl, átalakítás nélkül. A `serve` formátumot nem vált.

## A cél egy mondatban

A saját Telegram-chatből érkező YouTube-videó felirata és `info.json` fájlja a `peter-mba` gépen futó `refinery serve` folyamaton át az R2-be kerül, és a bot visszamondja a címet.

## Ezen a szeleten kívül

A vault, a `_queue.md`, a recept, a `run`, a Google-kötés, az olvasó oldal, a lejátszási lista feldolgozása, a LiteLLM és a költségplafon. A 2–4. szelet váz marad, ez a spec nem bontja ki.

## 1. A darabok

A Worker ajtó. A konténer a repó `src/`-jából épített CLI, és a `refinery serve` paranccsal fut. A mag könyvtár marad. A `serve` a fetch-utat függvényként hívja, a csővezetéket és a `.state/refinery.db` fájlt nem nyitja meg.

```text
Telegram --webhook--> Worker (D1, cron)
                         |  kopogtat a Tunnelon
                         v
                    refinery serve (peter-mba, homelab_net)
                     fetch subtitle → felirat + info.json
                         |  feltölt
                         v
                        R2
                         |  visszahívás: cím vagy hiba
                         v
                    Worker → második Telegram-üzenet
```

| Darab | Mit birtokol |
|---|---|
| Worker | Webhook, a saját chat engedélyezése, D1-sor, azonnali válasz, kopogtatás, percenkénti cron, a második üzenet. A bot tokenje itt van. |
| `refinery serve` | Egy videós munkát vesz át, a fetch-utat futtatja, feltölti a fájlokat, visszahív. A Docker-kép a `src/`-ból készül. |
| D1 | A bot nyoma: ki kérte, melyik üzenet, melyik videó, milyen állapot, mi a hiba, és a cím, amint ismert. |
| R2 | Nyelvenként a kiírt feliratfájl, és videónként az `info.json`. |
| Titok | Egy hosszú közös titok a kopogtatáson és a visszahíváson. A konténernek nincs bot-tokenje és nincs D1-hozzáférése. Az R2-kulcs a konténer környezetében van. |

A fetch kimenete a konténer volume-ján munkaállomány. A tartós példány az R2. A `worker/` csomag a `web/` mellett él, mert a Cloudflare Worker másik futtatókörnyezet. Külön `container/` csomag nincs.

## 2. A kérés útja

Egy Telegram-üzenetből videónként egy munka lesz. A Worker a mag `classifyInput` függvényével osztályoz. A `watch?v=…&list=…` cím videó. A sima lejátszási lista, az idegen oldal és a videó nélküli szöveg nem kerül a D1-be. A receptszó kimarad az értelmezésből.

A saját chat egy üzenetben kap választ, soronként egy tétellel. Idegen chatre nincs válasz és nincs D1-sor.

| Eset | Mondat |
|---|---|
| Elfogadott videó | `Sorba került: <videóazonosító>` |
| Lista | `Lejátszási lista későbbre marad.` |
| Nem YouTube-cím | `Nem YouTube-cím.` |
| Nincs videó az üzenetben | `Nincs YouTube-videó az üzenetben.` |
| A videó már `queued`, `waiting` vagy `accepted` | `Már sorban van: <videóazonosító>.` |
| A Tunnel nem válaszol | `A gép ébredésére vár: <videóazonosító>.` |
| A felirat az R2-ben van | `<cím>. A felirat megvan.` |
| Hiba | A fetch vagy a serve mondata, külön üzenetben |

A `ready` és a `failed` állapot után egy új üzenet új sort nyit. A D1 kulcsa az ismétlés ellen a Telegram `update_id`. A másodpéldány `200` választ kap, új sort nem ír, és nem kopogtat.

A Worker a választ összeállítja. Elfogadott videónként a sort `queued` állapotban írja, a webhooknak `200`-at ad, és csak utána kopogtat. A kanonikus cím `https://www.youtube.com/watch?v=<videóazonosító>`.

A kopogtatás `POST` a Tunnel címére, `Authorization: Bearer <REFINERY_SERVE_SECRET>` fejléccel. A test: `jobId`, `videoId`, `url`. A `refinery serve` egy munkát tart egyszerre, és csak a `127.0.0.1` címen hallgat.

| Válasz | Jelentés |
|---|---|
| `202` | Átvette. A fetch a válasz után fut. Ugyanaz a `jobId`, amíg a fetch tart, újra `202`, második letöltés nélkül. |
| `409` | Másik munka fut. A sor `queued` marad, Telegram-üzenet nincs. |
| `401` | Rossz titok. A sor `failed`, a cron nem ismétli. Az üzenet: `A konténer elutasította a hívást.` |

A serve a fetch-utat `--flat` elrendezéssel hívja, a konténer `--out` mappájába. `--sub-format` nincs: a fetch a `vtt/srt` sorrendet használja, nyelvenként egy fájllal, `--convert-subs` nélkül. A nyelv a config `languages` listája, ennek híján `hu,en`. A `.info.json` mindig a fetch része.

Az R2-kulcsok:

| Fájl | Kulcs |
|---|---|
| Felirat | `videos/<videóazonosító>/<nyelv>.<kiterjesztés>` |
| Meta | `videos/<videóazonosító>/info.json` |

A kiterjesztés `vtt` vagy `srt`, ahogy a fájl létrejött. A cím az `info.json` `title` mezője. Ha a mező üres, a videóazonosító a cím.

A készlet az `alreadyFetched` szabálya. Teljes, ha van legalább egy nem üres feliratfájl, amelynek a nyelve a beállított nyelvek egyikére illik, és az `info.json` `id` mezője ugyanez a videó. `en` kérésre `en-US` is illik. A serve ugyanezt a szabályt használja az R2 listáján és a helyi mappán.

A YouTube két esetben marad ki. Ha az R2-készlet teljes, a cím az ott lévő `info.json`-ból jön, és a visszahívás kész. Ha az R2 hiányos, de a helyi pár ugyanezen szabály szerint teljes, a serve a helyi fájlból tölt fel. Ha a helyi pár is hiányos, a serve a videó helyi fájljait törli, majd a fetch-utat overwrite nélkül hívja, hogy a letöltés elinduljon.

A visszahívás `POST <WORKER_CALLBACK_URL>/internal/jobs/<jobId>`, ugyanazzal a titokkal. Kész test: `status: ready`, `title`. Hibás test: `status: failed`, `error`.

A Worker a második üzenetet a visszahívásra küldi. A sor akkor lesz `ready`, amikor a küldés sikerül. Ha a küldés hibázik, a sor `accepted` marad, a cím a D1-ben van. Ismételt kész visszahívás második Telegram-üzenetet nem küld.

A D1 mezői: `update_id`, chat, üzenet, `jobId`, videóazonosító, az URL, állapot, hiba mondata, cím, és hogy a második üzenet elment-e.

## 3. Hibakezelés

A cron percenként fut. A `queued` és a `waiting` sort újra kopogtatja. Az ébredős üzenet a `queued` → `waiting` váltáskor megy ki, utána csend. A `failed` állapotot a cron nem éleszti fel. Újrapróbáláshoz új Telegram-üzenet kell.

A `202` után a sor `accepted`. Ha tizenöt percig nincs visszahívás, a cron ugyanazzal a `jobId` értékkel kopogtat. Ha a serve közben újraindult, a munkát elölről kezdi, a 2. szakasz R2- és helyi szabálya szerint. Ha a fetch még tart, a válasz `202`, második letöltés nélkül.

A hiányzó `yt-dlp` a fetch mondata, és a serve futva marad:

`A yt-dlp nem található a PATH-on. Telepítés: brew install yt-dlp vagy mise use yt-dlp`

Ha a fetch kész, de a feltöltés hibázik, a helyi fájl megmarad. A serve háromszor próbálkozik, majd `failed`, a mondat: `A feltöltés nem sikerült.` A következő kopogtatás a teljes helyi párból tölthet fel. Ha a feltöltés kész, de a visszahívás nem ér célba, a sor `accepted` marad, és a cron hozza a kész visszahívást.

A részleges nyelv a fetch saját eredménye. Nulla feliratnál az állapot `failed`, a mondat `Nincs felirat`, feltöltés nincs. Ha van illeszkedő felirat és érvényes info, a serve a kiírt fájlokat tölti fel, és sikeres üzenet után az állapot `ready`. A készlet ezzel teljes, a következő üzenet a YouTube-ot kihagyja.

## 4. A kód határa

A `refinery serve` a gyökércsomag parancsa, a `src/serve/` alatt. A `src/cli.ts` csak elindítja, és a súgó felsorolja. Négy része van: a HTTP-kapu, a munka futtatása, az R2-feltöltés `node:fetch` hívással, és a visszahívás. Új függőség nincs.

A `worker/` csomag a pnpm workspace-ben a `web/` mellett van. A magból a `classifyInput` függvényt importálja, a `package.json` külön `./classify` exportján, a `src/fetch/classify.ts` fájlból. A gyökér barrelt nem tölti be. A döntések tiszta függvények: üzenetből sor, állapotváltás, Telegram-mondat. A webhook, a cron, a D1 és a Telegram-hívás vékony borítás.

A Docker-kép a repó gyökeréből készül. Benne a Node 26.2, a `yt-dlp` és a lefordított `refinery`. A `CMD` a `refinery serve`. A fetch kimenetének mappája volume. Új config-kulcs nincs.

| Környezet | Hol | Mire |
|---|---|---|
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_OWNER_CHAT_ID` | Worker | bot és a saját chat |
| `SERVE_URL` | Worker | a Tunnel címe, ahová a Worker kopogtat |
| `WORKER_CALLBACK_URL` | serve | a Worker címe, a `/internal/jobs/<jobId>` útvonal elé |
| `REFINERY_SERVE_SECRET` | Worker és serve | a kopogtatás és a visszahívás |
| `SERVE_PORT` | serve | helyi port, alapból `8787`, csak `127.0.0.1` |
| `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | serve | feltöltés |
| D1 `DB` kötés | Worker | a sor |

## 5. Teszt

A viselkedést a meglévő Vitest fedi, új tesztfüggőség nélkül. Élő YouTube, Telegram, R2, Tunnel és Docker-képépítés nincs a futásban. A fetch meglévő tesztjei változatlanok.

A Worker döntései hamis D1-gyel és hamis HTTP-val:

- Egy üzenetből több videósor, a `watch?v=…&list=…` videó, a lista és az idegen cím elutasítása, a receptszó kihagyása, az idegen chat üres válasza, a videó nélküli üzenet mondata.
- Az ismételt `update_id` nem ír új sort és nem kopogtat.
- A `queued`, `waiting` és `accepted` videóra a válasz `Már sorban van`. A `ready` és a `failed` után új sor nyílik.
- A `202` állapot `accepted`. A Tunnel hiánya `waiting`, és az ébredős üzenet csak ezen a váltáson megy ki. A `409` a sort `queued` állapotban hagyja, üzenet nélkül. A `401` állapot `failed`.
- A sikeres Telegram-küldés után lesz a sor `ready`. Ha a küldés hibázik, `accepted` marad. Az ismételt visszahívás második üzenetet nem küld.
- A cron a `queued` és a `waiting` sort kopogtatja, a `failed` sort nem. A tizenöt perces `accepted` sort ugyanazzal a `jobId` értékkel kopogtatja.

A `src/serve/` tesztjei a fetch-utat és az R2-hívást helyettesítik:

- Rossz titok: `401`. Jó titok: `202`. A fetch `--sub-format` nélkül, `--flat` elrendezéssel, a config nyelveivel indul.
- Másik munka: `409`. Ugyanaz a `jobId`, amíg a fetch tart: újra `202`, második hívás nélkül.
- Teljes R2-készlet: YouTube-hívás nincs, a visszahívás a címet viszi.
- Hiányos R2 és teljes helyi pár: feltöltés, YouTube nélkül. Hiányos helyi pár: a serve törli a videó helyi fájljait, és a fetch letölt.
- A feltöltés a kiírt kiterjesztést használja. Nulla feliratnál nincs feltöltés, a mondat `Nincs felirat`.
- A hiányzó `yt-dlp` a fetch mondatát adja, a folyamat futva marad.
- A harmadik sikertelen feltöltés után a helyi fájl megmarad, a mondat `A feltöltés nem sikerült.`

A CLI súgója tartalmazza a `serve` parancsot.

## Siker

A saját chat videócímet küld. A bot azt írja, hogy sorba került. A konténer a feliratot és az `info.json` fájlt az R2-be teszi, majd a bot a címmel együtt azt írja, hogy a felirat megvan. Más chat nem megy át. Alvó gépen a sor megmarad, és a bot az ébredést mondja.
