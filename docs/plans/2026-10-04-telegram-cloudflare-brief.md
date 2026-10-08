# Brief — Telegram-vezérlés, otthoni refinery-konténer, olvasó oldal

**Dátum:** 2026-10-04
**Mire való:** ezt a briefet a superpowers `brainstorming` skill kapja bemenetként. Építészeti út: új alrendszer, nem egy meglévő folyamat kis módosítása. Nem döntésrekord, nem spec és nem implementációs terv. Implementáció nem indult.

A skill a lezárt döntéseket adottnak veszi, a nyitott pontokat bontja ki, és jóváhagyható tervet ad. A spec, ha megszületik, a repó szokása szerint a `docs/plans/` alá kerül (`YYYY-MM-DD-<téma>-spec.md`), nem a `docs/superpowers/specs/` alá.

A jogszerű SaaS-határ a brief vége felé a termékhatárt rögzíti, nem a személyes fetch megoldását. Jogértelmezés nem: a SaaS-szakasz a termékhatárt rögzíti, nem ügyvédi vélemény. A feliratot a refinery konténer tölti le a saját gép lakossági IP-jéről, a mostani `yt-dlp` folyamattal. Külön feliratszolgáltatás, edge-próba és lakossági proxy nincs.

## Mit vár a brainstorming

A teljes alak nagyobb egy specnél. A session erősítse meg a vázat, tartsa a szeleteket, és az első szeletet tervezze meg. A lezárt döntéseket ne kérdezze újra.

Az első szelet a bot és a D1-sor. A feldolgozás a `peter-mba` gépen futó refinery konténer, a meglévő CLI-vel. Az engedélyezőlista ekkor a saját Telegram chat-azonosító. A Google-kötés az első publikus Worker-útvonalhoz tartozik, a teljes olvasó oldal előtt.

Siker: a szándék felismerhető és javítható, és egy szeletre jóváhagyható terv születik. A terv jóváhagyása előtt implementáció nem indul.

**Kinek.** Először a tulajdonos, egy Google-fiókkal. A termék több felhasználó felé fejlődik. A második felhasználó nem új bot és nem új belépés.

**Szándék.** YouTube-videót Telegramról beadni. A Worker a `peter-mba` gépen futó refinery konténert hívja, a konténer dolgozza fel. A jegyzet belépés után olvasható, és a már létező privát vault-repóba kerül.

**Siker az első szeleten.** A bot sorba tesz. A konténer feldolgoz. A saját chat-azonosító engedélyezett, más nem.

## Lezárt döntések

Ezeket a válaszokat 2026-10-04-én a tulajdonos adta. A vázat ezek tartják.

| Kérdés | Válasz |
|---|---|
| A vault már létező privát repo, amit az Obsidian Git szinkronizál? | Igen. Személyes üzemben ez a repo. Több felhasználónál nem ez a séma közepe: fiókonként saját repó vagy tár. Ma az egy vault egy config-sor. |
| Hol fut a mag? | Docker-konténerben a `peter-mba` gépen, a `homelab_net` hálózaton, a LiteLLM és a sub2api konténer mellett. A Worker csak hívja. A csővezetéket nem futtatja, és nem Workers AI. |
| A LiteLLM marad a modellút? | Igen. A refinery konténer a `homelab_net` belső nevén hívja. A Worker nem hívja, és a gateway nem kerül ki a nyilvános internetre. A kulcs a konténer környezetében marad. |
| Hány olvasója van az oldalnak? | Egyelőre egy. Az engedélyezőlista egy e-mail. A D1 sorai a Google-azonosítóhoz (`sub`) tartoznak, ezért a második felhasználó szabály- és adatsorbővítés. |
| Hol lakik a felirat és a jegyzet? | Az R2 csak a `.vtt` fájlt tárolja. A konténer tölti fel. A Markdown csak a vaultban van. Az olvasó onnan kéri le, nincs második példány. |

Az azonosítás is eldőlt, lásd lent: egy bot, a fiók a Google-azonosító, a Telegram csatorna.

## A kérdés

A továbbfejlesztés iránya: az appot Telegram-botról lehessen vezérelni. A mag
Docker-konténerben fut a `peter-mba` gépen. A Cloudflare Worker serverless
alkalmazás fogadja a botot, és ezzel a konténerrel beszél. Telegramon be lehessen
adni, melyik YouTube-videókat dolgozza fel. A kimenet egy weboldalon legyen
olvasható, bejelentkezés után. A jegyzet a GitHubon lévő Obsidian-vaultba
kerüljön.

## Mire támaszkodik a válasz

A repó állapota a beszélgetéskor (`main`, v1.7.0):

- A mag könyvtár. A CLI, az Obsidian-queue és a Nuxt-felület fogyasztók, nem
  a mag fölöttesei. A felület csak olvas ([`decisions/0011`](../decisions/0011-webes-felulet-csak-olvas.md)).
- A csővezeték: discover, extract, normalize, classify, refine, render, publish,
  record. Modell csak a refine lépésben van.
- A bemenet kész `.vtt` / `.srt`. A `refinery fetch subtitle` a feliratot
  `yt-dlp` folyamattal tölti le (`src/fetch/command.ts`), helyi mappába.
- Az állapot SQLite, a `node:sqlite` moduljával, a munkakönyvtárban, nem a
  vaultban. A Node alsó határa 26.2.0.
- A vault-írás helyi fájl és git: futás előtt `git pull --ff-only`, utána commit
  és push csak a ténylegesen írt útvonalakra, force nélkül, write-once.
- A modellút egy elérhetőnek vett LiteLLM-gateway. A kulcs az egyetlen
  környezeti változó; a gateway telepítése nem a projekt feladata.

## A javasolt alak

A mag a `peter-mba` gépen fut, Docker-konténerben, a `homelab_net` hálózaton, a
LiteLLM és a sub2api konténer mellett. A Worker nem futtatja a csővezetéket.
Egy videó több modellhívás, a feliratletöltés folyamat, a vault helyi fájl és
git. Ezek a konténerben maradnak, ahol a `node:fs` és a `node:sqlite` megvan.
A Worker ajtó: fogadja a Telegramot, azonosít, sort tart, és a konténert hívja.
A meglévő elv marad: a mag könyvtár, a konténer a CLI helye, a Telegram és a
web ugyanaz a testvér, mint ma a CLI és a Nuxt.

```text
Telegram --webhook--> Worker (Cloudflare)
                          |
                          |  Cloudflare Tunnel
                          v
                    refinery konténer (peter-mba, homelab_net)
                     1. felirat, a mostani yt-dlp
                     2. normalize / classify
                     3. receptenként refine
                     4. render
                     5. .vtt az R2-be
                     6. Markdown commit a vaultba
                          |                 |
                          v                 v
                   LiteLLM, sub2api    privát vault-repo
                   belső néven         Obsidian Git húzza

Worker --> Pages olvasó (Access), a jegyzetet a vaultból olvassa
```

A Telegram-bot csak parancsot fogad, és státuszt küld. A webhook titkosított.
Az első szeletben csak a tulajdonos chat-azonosítója mehet át. A Google-kötés
után a kötött fiók chatje mehet át, és az engedélyt a Google-fiók adja, nem a
chat-azonosító. Egy üzenet egy vagy több YouTube-cím, és megnevezheti a
recepteket. Ha nem nevezi meg, a bot rákérdez. A javaslat a Receptválasztás
szakaszban van, még nincs eldöntve. A bot azonnal visszaírja, hogy sorba került,
és a végén a jegyzet linkjét. Nem várja meg a feldolgozást. A bot tokenje a
Workeren marad. A konténer a Workernek jelez, amikor a jegyzet megvan.

A Worker a konténert Cloudflare Tunnelen éri el, nem nyitott porton. A
`cloudflared` kifelé csatlakozik. A végpont nem kerül nyilvános internetre. A
hitelesítés Access service token vagy egy hosszú közös titok a fejléchez. A
konténer nem fogad tetszőleges shell-parancsot, csak a videót és a recepteket.

Ha a `peter-mba` alszik, a Tunnel nem válaszol. A kérés a D1-ben megmarad, a
Telegram azt írja, hogy a gép ébredésére vár, és a Worker újrapróbálja.

| Darab | Szerep |
|---|---|
| Worker | webhook, azonosítás, sor, olvasó API. Hosszú munkát nem végez |
| refinery konténer | a csővezeték: felirat, normalize, refine, render, vault-írás |
| LiteLLM, sub2api | a modellút, ugyanazon a `homelab_net` hálózaton. Csak a konténer hívja |
| D1 | a bot sora és a Google-kötés. Nem a csővezeték állapota |
| SQLite | a konténer volume-ján, a mostani `.state/refinery.db`: kész, hiba, költség |
| R2 | csak a nyers `.vtt`. A konténer tölti fel. Markdown nem kerül ide |
| Pages | olvasó felület. A jegyzetet a vaultból olvassa |

A modellút a LiteLLM marad, a rubrika minősége miatt nem Workers AI. A kulcs a
konténer környezetében az egyetlen ilyen változó. A költséget később
Google-fiókonként kell számolni, nem Telegram-azonosítónként; ezt most nem
építjük meg.

A kész Markdownnak egy helye van, a vault. A konténer ugyanazt a git
műveletet végzi, amit a CLI ma: futás előtt `pull`, utána commit és push a
ténylegesen írt útvonalakra. Az R2 a `.vtt` tárja, semmi másé. A kulcs videó és
nyelv szerint stabil, ezért egy későbbi recept ugyanazt a feliratot használja,
és a YouTube-ot nem hívja újra. A cím, a csatorna és a többi `info` a konténer
állapottárában marad, az elem mellett. Az olvasó a jegyzetet a privát repóból
kéri le, a commit tokenjével. Egy oldalnézet egy lekérés, a Worker a választ
rövid ideig cache-elheti.

## Azonosítás

Egy bot van. A bot-token egy, a Telegram-felhasználó sok lehet. A fiók a
Google-azonosító (`sub`). A Telegram-beszélgetés rákötött csatorna, nem a fiók
maga. Később ugyanehhez a Google-fiókhoz tartozik a webes olvasó, külön
Telegram-regisztráció nélkül.

A bot a chatben nem tud Google-bejelentkezést megjeleníteni. Külön bejelentkező
oldalt sem írunk: a Cloudflare Access Google-identitásszolgáltatója végzi,
Workspace nélkül. Bármely Google-fiók azonosíthat, a szabály szűr. Most egy
e-mail van az engedélyezőlistán. Ugyanez a belépés védi majd az olvasó oldalt.
Az email egyszeri kód kiesett: a fióknak stabil azonosító kell, nem alkalmi kód.

A kötés menete:

1. A felhasználó a `/start` parancsot küldi, és még nincs kötés.
2. A bot egy egyszer használatos, pár perces linken válaszol.
3. A link a rendszer böngészőjében nyílik (Safari vagy Chrome), nem a Telegram beépített nézetében.
4. Az Access Google-lel azonosít.
5. A Worker összeköti a Telegram-felhasználót a Google-azonosítóval, majd visszadob a `t.me/<bot>?start=<token>` címre.
6. A bot azt írja, melyik e-mail cím lépett be. Innentől a parancsok ehhez a fiókhoz futnak.

A Google 2021 óta a beágyazott WebView-ban visszautasítja a bejelentkezést
(`403 disallowed_useragent`). A Telegram saját böngészője ebbe esik, ezért a
Mini App-os Google-login nem út. A külső böngésző és a `t.me` visszalink a
stabil minta. A token egyszer használatos, és percek alatt lejár. A bot
szerveroldalon váltja be.

Amíg nincs publikus útvonal, az engedélyezőlista a tulajdonos Telegram
chat-azonosítója. A Google-kötés az első ilyen útvonalon jön létre, még a
teljes olvasó oldal előtt. Onnantól a parancsot a Google-fiók engedélyezi, nem
a chat-azonosító.

## Olvasó oldal

Saját logint nem érdemes építeni. A belépés a fenti Access, Google-identitásszolgáltatóval.
Most egy e-mail cím van az engedélyezőlistán. A Pages a D1-ből listáz, a
jegyzetet a vaultból olvassa. Az R2-höz az oldal nem nyúl. A mostani Nuxt
szerződése marad: a web nem indít
futást, azt a Telegram teszi. Egy olvasó van most. A második felhasználó ugyanide
lép be, ha a szabály engedi.

## Vault

A vault már létező privát repo, nem a `transcript-refinery` repó. Az Obsidian
Git szinkronizálja. A mostani szabályok maradnak: csak az
`Inbox/transcript-refinery/` alá ír, write-once, nincs force push, csak a
ténylegesen írt útvonalak kerülnek commitba. A konténer ezt a helyi git
műveletet végzi, fine-grained tokennel, csak arra a repóra. Ha
ugyanazt a jegyzetet közben kézzel szerkesztik, a pipeline nem írja felül.
A Markdown csak itt lakik, második példány nincs az R2-ben.

Ez a személyes üzem. Több felhasználónál minden fiók a saját repóját vagy tárát
kapja. A D1 a Google-azonosítóhoz köt, nem egyetlen globális vault-útvonalhoz.
A pontos tár-alak nyitott, a mostani egy repo config.

## Szeletek

Mindegyik külön bizonyítja, hogy a következő nem felesleges:

1. Bot és D1-sor. A feldolgozás a refinery konténer, a meglévő CLI-vel. A
   konténer a felirat `.vtt` fájlját feltölti az R2-be. Az engedélyezőlista a
   saját Telegram chat-azonosító, mert még nincs publikus útvonal. Ezzel a
   vezérlés kész.
2. A konténer egy receptet futtat (`summary`). A `.vtt` az R2-be kerül, a
   `_summary.md` a vaultba, a link a Telegramban erre a jegyzetre mutat.
3. Olvasó oldal Access mögött, a jegyzetet a vaultból olvassa. Az első publikus
   Worker-útvonal, még a teljes oldal előtt, a Google-kötés. Onnantól a
   parancsot a Google-fiók engedélyezi.
4. A többi recept és a költségplafon. A jegyzetük szintén csak a vaultba kerül.

A Google-kötés nem külön termék-szelet: a 3. szelet első publikus útvonala.
A playlist későbbre marad: a bot videónként külön munkát ad a konténernek,
különben egy üzenet órákig tart.

## Receptválasztás

**Állapot:** lezárva 2026-10-08-án: csak gombbal, receptnév gépelése nélkül. Lásd [`2026-10-08-telegram-receptek-spec.md`](./2026-10-08-telegram-receptek-spec.md). Az alábbi javaslat a döntés előzménye.

A kérdés: a bot honnan tudja, hogy egy videóra a `summary` készüljön, a `notes`,
vagy mind a kettő. Ma ezt a [`0010`](../decisions/0010-videonkenti-receptvalasztas.md)
dönti el. A `_queue.md` videónként és receptenként ad egy pipát. A `run --queue`
a kipipált (videó, recept) párokat viszi, egy közös költségplafon alatt. A
`run --recipe` queue nélkül futás-szintű: egy recept minden kiválasztott elemre.
Recept nélkül a `run` csak a `<alapnév>_transcript.md` fájlt írja, modellt nem hív.

A bot ugyanezt a párt kéri, nem talál ki új egységet. A regiszter ma:
`summary`, `flashcards`, `qa`, `clean-mild`, `clean-moderate`, `clean-deep`,
`bloom`, `notes`, és a bekonfigurált fordítások (`summary-hu`).

A javasolt menet:

1. Az üzenet megnevezheti a recepteket a címek mellett: `summary notes`, vagy
   több cím és utána a lista. Ismeretlen azonosítóra a bot rákérdez, és nem
   találgat.
2. Ha csak cím jön, a bot gombokat ad a regiszterből. Nincs csendes „minden
   recept”: a 0010 azért van, mert nem minden videó kér mindent, és a plafon
   az egész indításra közös.
3. Az első szeletekben nincs mentett alapértelmezés. Később fiókonként lehet.
   A bot a sorba tételkor visszaírja, mely párokat vette fel, hogy megállítható
   legyen.
4. A `_transcript.md` nem gomb és nem recept. A feliratból készül, ha bármely
   recept fut, ugyanúgy, ahogy a `run` recept mellett az átiratot is kiírja.
5. A fordítás csak akkor, ha külön kérik, és a forrásrecept kész vagy ugyanebben
   a munkában kért. Enélkül megnevezett okkal kimarad, ahogy ma is.

A szelet 1 hídja még választás. A konténer a `_queue.md` pipáit olvassa, a
D1-et nem.

- A bot a választott párokat bepipálja a `_queue.md`-ben, és csak azt a fájlt
  commitolja. A konténer `run --queue` vagy `watch` dolgozza fel. Új parancs
  nincs. A vault-írás előbb jön, de csak a sorra, a jegyzetek a 4. szeletben.
- A párok csak a D1-ben vannak, és a Worker a konténernek adja át őket. A
  vault a 4. szeletig érintetlen, cserébe a meglévő `run` magától nem látja a
  bot kérését.

Az első a kisebb szelet, mert a kész fogyasztó a `run --queue`. A D1 ilyenkor a
bot nyoma: ki kérte, melyik üzenet, mi a státusz. Nem második feldolgozási sor.
A 2. szelettől a Worker a párokat a konténernek adja, és a bot nem ír többé a
`_queue.md`-be. A két hely nem marad egyszerre a „ezt kérem” forrása.

## Jogszerű SaaS

A jogi határ nem a Cloudflare és nem a login. A határ az, hogy a felirat honnan jön,
és kinek a műve. A személyes bot a saját gép `yt-dlp`-jével szedi le a
tetszőleges YouTube-címet. Ebből a formából nem lesz jogszerű SaaS. A finomító
mag igen.

A YouTube feltételei az automatizált letöltést és a nem engedélyezett hozzáférést
kizárják, kivéve a hivatalos API-t, ott is csak a dokumentált jogosultsággal. A
`captions.download` OAuth-ot kér, és csak akkor ad feliratot, ha a hívónak
szerkesztési joga van a videóra. Idegen, nyilvános videóra API-kulccsal 403 a
válasz. A kvóta hívásonként 200 egység. A lakossági proxy és a timedtext épp azt a
technikai korlátot kerüli meg, amit a feltétel tilt. Ez a személyes szürke zóna;
fizető ügyfeleknek árulva szerződéses és szerzői jogi kockázat, és a proxycég
feltétele is ellene fordul.

A felirat a mű része. A nyilvánosság nem jogosít másolásra vagy továbbadásra. Az
unós szöveg- és adatbányászati kivétel (DSM 4. cikk) csak jogszerű hozzáférésnél él,
és a jogosult géppel olvasható fenntartással kizárhatja. Egy szolgáltatás
felhasználási feltétele ilyen fenntartás. Egy SaaS, ami idegen videók teljes
átiratát tárolja és kiadja, erre nem hivatkozhat.

Három termék marad, mind a meglévő magra épül. A fetch kiesik a termékből.

1. Az ügyfél hozza a feliratot. Feltölt egy `.vtt` vagy `.srt` fájlt, amit eleve
   joga van kezelni: saját export, YouTube Studio a saját videójáról, licencelt
   fájl, meeting. A csővezeték ettől kezdve ugyanaz, mint ma. A döntés, hogy a
   bemenet kész feliratfájl, már a repóban van
   ([`decisions/0008`](../decisions/0008-forras-fuggetlen-bemenet.md)). A
   Telegramon nem URL érkezik, hanem fájl. A web a saját jegyzeteit mutatja, a
   vault az ő repója vagy az ő tárhelye.
2. Saját csatorna, hivatalos API-val. Az ügyfél YouTube-OAuth-tal beköt egy
   csatornát, amin szerkeszthet. A feldolgozás csak `captions.download`-ot hív,
   `youtube.force-ssl` scope-pal. Nincs `yt-dlp`, nincs timedtext, nincs proxy.
   A kvóta miatt ez nem tömeges idegen korpusz, hanem a saját videók
   feldolgozása. A partnerút ugyanez: a tartalomtulajdonos ad jogot, a hívás az ő
   nevében megy.
3. Nem-YouTube forrás, ami eleve az övé. Feltöltött hang, podcast-RSS a saját
   műsoráról, Zoom, a vaultjában lévő fájl. Itt a transzkripció is a termék része
   lehet, mert a hangot ő adta be. A YouTube-letöltés továbbra sem.

Amit nem érdemes árulni: „bármely YouTube-linkre jegyzet”, nyilvános átirattár, és a
proxy mint megbízhatósági réteg. A kimenet is szűkül. Az ügyfél a saját fiókjában
olvassa a jegyzetet. Teljes idegen átirat kimásolható katalógusa, keresője
másoknak, nincs. Az összefoglaló sem varázsolja el a jogot, ha a forrás jogellenesen
került be. A tárolás célhoz kötött: a fiók törlésekor a felirat és a jegyzet is megy.

A személyes bot feldolgozása a saját gépen fut, a saját vaultra. A SaaS a másik
szerződés: feltöltés vagy saját csatorna OAuth, Cloudflare Access vagy rendes
fiók, D1-ben ügyfélenként elkülönített állapot, R2-ben az ő `.vtt` fájlja, a
jegyzet a saját vaultjában. A recept, a rubrika és a render változatlan.

### Mit jelent a saját videó

A saját videó azt jelenti, hogy a felhasználó feltöltötte, vagy a csatornán
szerkesztési joga van rá. A saját lejátszási listára gyűjtött idegen videó nem ilyen.

A `captions.download` feltétele, hogy a hívónak szerkesztési joga legyen az adott
videóra. Ezt OAuth adja, `youtube.force-ssl` vagy `youtubepartner` scope-pal. A
lista tulajdonjoga ezt nem adja meg: a lista elemeinek lekérése megy, a felirat
letöltése az idegen videón 403. Ugyanez a mentett videó és a „Később megnézem” lista.

Ami átmegy: a saját csatornára feltöltött videó, a közös csatorna, ha a felhasználó
kezelő rajta, és a tartalompartner út, ahol a tulajdonos nevében megy az API-hívás.
A lejátszási lista csak szűrő lehet a már szerkeszthető videók között, nem
jogosultság.

## Nyitott pontok

A vault, a LiteLLM, az egy olvasó, a fájlok helye és a mag helye eldőlt, ahogy
az egybotos Google-azonosítás is. A mag a `peter-mba` konténere. Az R2 csak a
`.vtt`, a Markdown csak a vault. Feliratszolgáltatás, edge-próba és lakossági
proxy nincs. Ezeket a brainstorming ne nyissa újra.

Ami marad:

- Több felhasználónál a tár pontos alakja. Az irány kötött: a fiók
  Google-azonosító, a mostani egy vault config, később fiókonként saját repó
  vagy tár.
- A playlist szétbontása. Későbbre marad, nem az első szelet.
- A bot receptválasztása. A javaslat a Receptválasztás szakaszban van: az üzenet
  vagy a gombok adják a (videó, recept) párt, csendes „minden recept” nincs. A
  szelet 1 hídja nincs választva: a bot a `_queue.md`-be pipál, vagy a CLI új
  olvasót kap a D1-re.
