# Spec — A harmadik szelet: Google-kötés és olvasó oldal

**Dátum:** 2026-10-07 · **Státusz:** jóváhagyásra vár

Ez a dokumentum a [`2026-10-04-telegram-cloudflare-brief.md`](./2026-10-04-telegram-cloudflare-brief.md) harmadik szeletéből és a jóváhagyott tervezésből készült. Az előző szeletek spece a [`2026-10-04-telegram-cloudflare-spec.md`](./2026-10-04-telegram-cloudflare-spec.md) és a [`2026-10-05-telegram-summary-spec.md`](./2026-10-05-telegram-summary-spec.md). Ahol ez a spec nem mond mást, az ottani viselkedés marad.

A szelet két részben épül, két implementációs tervvel és két PR-ral:

- **3a, kötés.** Az első publikus Worker-útvonal. A Telegram-felhasználó egy Google-fiókhoz kötődik, és onnantól a parancsot a Google-fiók engedélyezi, nem a chat-azonosító.
- **3b, olvasó.** A boton át készült jegyzetek listája és nézete, belépés után, a vaultból olvasva.

A 3b a 3a után indul. A 3a önállóan élesíthető.

## A cél egy mondatban

A bot a `/start` után Google-belépéssel köti a Telegram-felhasználót a fiókhoz, a parancsot onnantól az engedélyezett e-mail adja, és a summary linkje egy belépéshez kötött oldalra visz, ami a jegyzetet a vaultból mutatja.

## Ezen a szeleten kívül

A többi recept, a költségplafon, a lejátszási lista, a `/unlink` parancs, a lapozás az olvasóban, a fiókonkénti vault, és a `refinery serve` bármilyen változása. Külön titok a kopogtatásra és a visszahívásra, a `noteUrl` előtag-szűrése a botban, és élesítési `curl`-próbák sem részei a szeletnek.

## 1. A darabok

Minden útvonal ugyanabban a Workerben van. Új Worker vagy Pages-projekt nincs.

```text
Telegram --webhook--> Worker /telegram          (webhook-titok)
konténer --visszahívás--> Worker /internal/...  (serve-titok)
böngésző --Access, Google--> Worker /link       (3a)
böngésző --Access, Google--> Worker /notes      (3b)
                              |
                              +--> D1: jobs, bindings, link_tokens
                              +--> GitHub contents API (3b, csak olvasás)
```

| Útvonal | Védelem | Szerep |
|---|---|---|
| `POST /telegram` | webhook-titok, mint ma | üzenet, gomb, `/start`, `/start <token>` |
| `POST /internal/jobs/:id` | serve-titok, mint ma | a konténer visszahívása |
| `GET /link?t=<token>` | Access, és a Workerben azonosító nélkül `403` | függő kötés, majd átirányítás a Telegramba |
| `GET /notes` | ugyanígy | a saját jegyzetek listája (3b) |
| `GET /notes/:jobId` | ugyanígy | egy jegyzet (3b) |
| minden más | — | `404` |

Az útválasztás pontos, kisbetűs illesztés. A `/Notes`, a `/notes/` és a `//link` `404`.

A `/telegram` és az `/internal/*` nem kerülhet Access mögé, mert a Telegram és a konténer nem lép be. Az Access-alkalmazás csak a `/link` és a `/notes` útvonalat fedi. A fiókszintű „minden Worker védelme” kapcsoló nem kapcsolható be, mert a webhookot is elzárná.

### Az azonosító

A védett útvonal a belépett felhasználó `sub` és `email` értékét a Workerben olvassa ki. Ha nincs érvényes azonosító, a válasz `403`, akkor is, ha az Access-szabály hibás. Az Access tehát nem az egyetlen kapu.

A forrás a `ctx.access`. Ez csak akkor létezik, ha a kérést az Access hitelesítette, és a JWT-t a futtatókörnyezet ellenőrzi. A Worker a `ctx.access.getIdentity()` hívás `email` és `user_uuid` mezőjét olvassa. Ha a `ctx.access` hiányzik, vagy a két mező közül bármelyik üres, a válasz `403`. Új függőség nincs.

A `sub` ebben a specben az Access `user_uuid` értéke: a fiókon belül e-mail-címenként egyedi és stabil. Ez nem a Google saját `sub` azonosítója, amit a brief említ. Egy fióknál és egy identitásszolgáltatónál a kettő ugyanazt a személyt jelöli. A Google-azonosítót külön kiolvasni ma fölösleges munka lenne.

### Az engedélyezés

Egy Telegram-frissítés akkor megy át, ha a küldő `from.id` értéke kötött, és a kötött e-mail szerepel az `TELEGRAM_ALLOWED_EMAILS` listán. A lista vesszővel elválasztott, a kis- és nagybetű nem számít. Ha egy e-mail lekerül a listáról, a hozzá kötött felhasználó azonnal kiesik, a kötés megmaradása mellett is.

A `TELEGRAM_OWNER_CHAT_ID` megszűnik. A `send` a sor saját `chat_id` értékére küld, nem egy rögzített chatre. A `decideTap` a „tulaj-e” helyett az „engedélyezett-e” jelzést kapja.

### Az adatok

A `0003` migráció:

| Tábla | Oszlopok | Szerep |
|---|---|---|
| `bindings` | `telegram_user_id` (kulcs), `sub`, `email`, `bound_at` | Telegram-felhasználó ↔ Google-fiók. Egy Telegram-felhasználónak egy kötése van. Egy `sub`-hoz több Telegram-felhasználó tartozhat. |
| `link_tokens` | `token_hash` (kulcs), `telegram_user_id`, `expires_at`, `pending_sub`, `pending_email`, `used` | A kötés egyszer használatos tokenje. |
| `jobs` | új oszlop: `sub` | A sor Google-fiókja. A régi sorokban üres, a kötés tölti ki. |

A `memoryStore` ugyanezeket a műveleteket tudja.

### Worker-változók

| Változó | Rész | Szerep |
|---|---|---|
| `TELEGRAM_ALLOWED_EMAILS` | 3a | az engedélyezett e-mailek |
| `TELEGRAM_BOT_USERNAME` | 3a | a `t.me/<bot>` link |
| `VAULT_GITHUB_TOKEN` | 3b | fine-grained token, csak olvasás, csak a vault-repóra |
| `VAULT_REPO` | 3b | `<tulaj>/<repo>` |
| `VAULT_BRANCH` | 3b | a vault ága |

A `TELEGRAM_OWNER_CHAT_ID` törlődik a Workerből. A helyi debug-script továbbra is olvassa az Infisicalból, és ezzel írja be a helyi D1-be a saját kötését, mert helyben nincs Access.

## 2. A kötés (3a)

A kötés két lépéses, két tokennel. A linktoken a bot üzenetében utazik. A visszatérő tokent a `/link` a belépés után készíti, és csak a belépett böngésző kapja meg, az átirányításban. A kötés akkor jön létre, amikor a visszatérő tokent ugyanaz a Telegram-felhasználó küldi be, aki a linktokent kérte.

Ez egy támadást zár ki. Egy idegen kér egy linket, és elküldi a tulajdonosnak. A tulajdonos belép a saját Google-fiókjával. A visszatérő token a tulajdonos böngészőjébe és Telegramjába kerül, ahol a `from.id` nem egyezik, ezért a kötés nem jön létre. Az idegen a saját linktokenjét ismeri, de az nem köt, mert nincs rajta függő fiók. Egyetlen tokennel ez a védelem nem állna meg: az idegen a belépés után maga küldené be ugyanazt a tokent, egyező `from.id`-vel.

### A menet

1. A nem kötött felhasználó `/start` üzenetet küld.
2. A Worker 32 véletlen bájtból tokent készít, base64url kódolással. Ez 43 karakter, belefér a Telegram 64 karakteres `start` paraméterébe. A D1-be a token SHA-256 hash-e kerül, a küldő `from.id` értéke, és a lejárat: most + 10 perc.
3. A bot a linket küldi. A link a rendszer böngészőjében nyílik, nem a Telegram beépített nézetében.
4. Az Access Google-lel azonosít, és csak az engedélyezett e-mailt engedi át.
5. A `/link` elhasználja a linktokent, és új, visszatérő tokent készít ugyanazzal a `telegram_user_id` és lejárat értékkel, a `pending_sub` és `pending_email` mezőben a belépett fiókkal. Ezután `302`-vel a `https://t.me/<TELEGRAM_BOT_USERNAME>?start=<visszatérő token>` címre irányít.
6. A Telegram a felhasználó nevében `/start <visszatérő token>` üzenetet küld. A Worker ellenőriz, és köt.

A két token ugyanabban a `link_tokens` táblában él. A linktokenen nincs függő fiók, a visszatérőn van. A `/start <token>` csak függő fiókkal rendelkező tokent fogad el, a `/link` csak függő fiók nélkülit.

### A nem kötött felhasználó

Ide tartozik az is, akinek a kötött e-mailje már nincs az `TELEGRAM_ALLOWED_EMAILS` listán.

| Bemenet | Eredmény |
|---|---|
| `/start` paraméter nélkül | Új token. A válasz: `Kösd össze a Google-fiókoddal (10 percig érvényes): https://<worker>/link?t=<token>`. A korábbi, el nem használt token a lejáratáig érvényes marad. |
| bármi más üzenet | `Előbb kösd össze a Google-fiókoddal: /start` Kopogtatás nincs. |
| gombnyomás | Üres `answerCallbackQuery`. Más nincs. |

### `GET /link?t=<token>`

| Állapot | Eredmény |
|---|---|
| Nincs azonosító | `403` |
| A token ismeretlen, lejárt, elhasznált, vagy visszatérő token | HTML-oldal: `A link lejárt vagy már nem érvényes. Kérj újat a botban: /start` |
| A token érvényes linktoken | A linktoken elhasználódik, a visszatérő token létrejön, majd `302` a `t.me` címre. |

Ha a böngésző nem nyitja meg magától a Telegramot, a `t.me` oldal maga ad „megnyitás” gombot, ezért saját köztes oldal nincs. Az e-mailt a `/link` nem szűri az `TELEGRAM_ALLOWED_EMAILS` szerint. Ezt az Access teszi, és a következő lépésben a bot.

### `/start <token>`

| Állapot | Eredmény |
|---|---|
| A token érvényes, van függő `sub`, a `from.id` egyezik, az e-mail engedélyezett | A kötés létrejön, vagy felülírja a régit. A token elhasználódik. A felhasználó korábbi sorai, azonos `chat_id` mellett, megkapják a `sub` értéket. Az üzenet: `Bekötve: <e-mail>.` |
| Ugyanez, de az e-mail nincs a listán | Nincs kötés. A token elhasználódik. Az üzenet: `Ez a Google-fiók nincs engedélyezve: <e-mail>.` |
| A `from.id` nem egyezik, a token lejárt vagy elhasznált, vagy még nincs függő `sub` | Nincs kötés. Az üzenet: `A link lejárt vagy már nem érvényes. Kérj újat: /start` |

### A kötött, engedélyezett felhasználó

A címküldés, a gomb, a cron és a visszahívás a második szelet szerint megy. Az új sor megkapja a küldő `sub` értékét. A `/start` paraméter nélkül: `Már be vagy kötve: <e-mail>.` A `/start <token>` kötött felhasználótól is a fenti táblázat szerint megy, így egy másik Google-fiókra át lehet kötni.

A lejárt tokenek a táblában maradnak. Egy felhasználónál ez néhány sor. A takarítás akkor jön, ha a tábla mérete számít.

## 3. Az olvasó (3b)

### `GET /notes`

Azonosító nélkül `403`. A lista a belépett `sub` sorai, amelyeknek van `note_url` értéke, újak elöl, az `accepted_at` szerint. Soronként a cím, a dátum és a `/notes/:jobId` link. Üres lista esetén: `Még nincs jegyzet. Küldj egy YouTube-címet a botnak.` Lapozás nincs.

Csak a boton át készült jegyzetek látszanak. A CLI-vel vagy a `_queue.md`-vel készültekről a D1 nem tud.

### `GET /notes/:jobId`

1. Azonosító nélkül `403`. Ha a sor nem létezik, vagy más `sub`-é, `404`. A két eset ugyanaz a válasz.
2. Az útvonal a sor `note_url` értékéből jön. A Worker leválasztja a `https://github.com/<VAULT_REPO>/blob/<VAULT_BRANCH>/` előtagot, és a maradékot dekódolja. Ha az előtag nem egyezik, a válasz `404`, és GitHub-hívás nincs.
3. A Cache API kulcsa a `jobId`, az élettartam 5 perc. A cache-t csak az engedélyezés után nézzük.
4. Cache-tévesztésnél a Worker hívja: `GET https://api.github.com/repos/<VAULT_REPO>/contents/<útvonal>?ref=<VAULT_BRANCH>`, `Accept: application/vnd.github.html+json`, `Authorization: Bearer <VAULT_GITHUB_TOKEN>`. A válasz a GitHub szanitizált HTML-je.
5. Az oldal: a cím, a „Megnyitás a GitHubon” link a `note_url` címre, és a renderelt HTML. Beágyazott CSS, rendszerbetűtípus, sötét mód a `prefers-color-scheme` szerint. Külső szkript nincs.

A HTML-t a GitHub állítja elő, nem a Worker. A jegyzet modellkimenet egy idegen videó feliratából, ezért nyers HTML-ként nem kerülhet az oldalba. A Worker által beírt értékeket — cím, e-mail, hibamondat — a sablon escape-eli.

Az implementáció első lépése egy valódi jegyzeten igazolja, hogy ez a fejléc ezen a végponton renderelt HTML-t ad, és megnézi, hogyan jelenik meg a frontmatter és a `[[wikilink]]`. Ha a frontmatter zavaró, a Worker a nyers tartalmat kéri, a frontmattert levágja, és a `POST /markdown` végpont renderel.

### Hibák

Egyszerű HTML-oldal, `502` állapottal:

| Eset | Mondat |
|---|---|
| A GitHub `404` | `A jegyzet nincs a vaultban.` |
| A GitHub `401` vagy `403` | `A vault nem olvasható.` |
| Hálózati hiba vagy más állapotkód | `A GitHub nem érhető el.` |

### A bot linkje

A 3b-től a summary kész üzenetének második sora `https://<worker>/notes/<jobId>`. A `note_url` a D1-ben GitHub-cím marad, mert az útvonal forrása. A visszahívás teste nem változik.

## 4. A kód határa

Minden változás a `worker/` alatt van. A tiszta döntések a `plan.ts` mintáját követik, a mellékhatások a `handle.ts` és az `index.ts` mintáját, a mondatok a `messages.ts` fájlba kerülnek.

| Fájl | Tartalom |
|---|---|
| `plan.ts` | Tiszta `isAllowed`, `decideStart`, token és hash (3a). |
| `handle.ts` | `/start`, `/start <token>`, `handleLink`, a kötött felhasználó engedélyezése (3a). |
| `index.ts` | A `/link` útvonal és a `ctx.access` kiolvasása (3a). |
| `reader.ts` | Az útvonal a `note_url` értékből, a GitHub-hívás, az oldal-HTML (3b). |
| `store.ts`, `d1.ts` | `bindings`, `link_tokens`, `jobs.sub`. |
| `migrations/0003_bindings.sql` | A három változás. |

A `src/serve/` és a CLI nem változik.

## 5. Teszt

A meglévő Vitest fedi, hamis tárral, hamis `send` függvénnyel és hamis `fetch` hívással. Éles Telegram, Access és GitHub nincs a futásban. A második szelet tesztjei maradnak, a tulaj-feltétel helyett kötött, engedélyezett felhasználóval.

*3a:*

- A nem kötött felhasználó címére a „kösd össze” sor jön, kopogtatás nincs. A `/start` linket ad, és a D1-ben a token hash-e van, nem maga a token.
- `/link`: azonosító nélkül `403`. Lejárt, ismeretlen, elhasznált vagy visszatérő token esetén a hibaoldal. Érvényes linktoken esetén a visszatérő token, és `302` a `t.me` címre.
- `/start <token>`: mind a négy eset. Köztük az idegen, aki a saját linktokenjét küldi be a tulajdonos belépése után, és a tulajdonos, aki az idegen kérte visszatérő tokent küldi be. Egyik sem köt.
- A kötés után a régi sorok megkapják a `sub` értéket. Ha az e-mail lekerül az `TELEGRAM_ALLOWED_EMAILS` listáról, a felhasználó kiesik. A `send` a sor chatjére küld.
- A `/Link` és a `//link` `404`. A `/telegram` és az `/internal` a mai módon viselkedik.

*3b:*

- A lista csak a saját `sub` sorait mutatja. Az idegen és a nem létező `jobId` ugyanazt a `404` választ adja.
- Ha a `note_url` előtagja nem egyezik, `404`, GitHub-hívás nélkül.
- A GitHub `404`, `401` és hálózati hibája a táblázat mondatát adja. A cím és a hibamondat escape-elve kerül az oldalba.
- A summary kész üzenete a `/notes/<jobId>` linket küldi.

## 6. Élesítés

Kézi lépések, a tervek utolsó feladataként:

1. Access-alkalmazás a Worker hosztnevén, a `/link` és a `/notes` útvonalra, Google-identitásszolgáltatóval, egy e-mailes szabállyal.
2. A `0003` migráció.
3. A változók és titkok. 3a: `TELEGRAM_ALLOWED_EMAILS`, `TELEGRAM_BOT_USERNAME`, a `TELEGRAM_OWNER_CHAT_ID` törlése. 3b: a három `VAULT_*` változó.
4. Telepítés.
5. A tulajdonos `/start` üzenete és a kötés.

A telepítés és a kötés között a bot mindenre a „kösd össze” sort adja. Átmeneti kettős üzem nincs.

## Siker

**3a.** A tulajdonos `/start` üzenetet küld, a böngészőben belép a Google-fiókjával, visszatér a Telegramba, és a bot ezt írja: `Bekötve: <e-mail>.` Onnantól a címküldés és a summary gomb úgy megy, mint a második szeletben. Egy idegen Telegram-fiók nem jut tovább, akkor sem, ha a linkjét a tulajdonos nyitja meg és lépteti be. Az e-mail törlése az engedélyezőlistáról azonnal kizár.

**3b.** A summary linkje a `/notes/<jobId>` oldalra visz. Az oldal belépés nélkül nem nyílik meg. Belépés után a jegyzet a vaultból jelenik meg, a `/notes` pedig a saját jegyzetek listáját adja.
