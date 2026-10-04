# Telegram-vezérlés, Cloudflare-mag, olvasó oldal, vault-commit

Jegyzet egy 2026-10-04-i tervezőbeszélgetésről. Nem döntésrekord és nem
implementációs terv: a kérdést, a mostani kódra támaszkodó választ és a nyitott
pontokat rögzíti. Implementáció nem indult. A felirat-fallback, a lakossági
proxy és a jogszerű SaaS-határ a beszélgetés későbbi kibontása. Jogértelmezés
nem: a SaaS-szakasz a termékhatárt rögzíti, nem ügyvédi vélemény.

## A kérdés

A továbbfejlesztés iránya: az appot Telegram-botról lehessen vezérelni. A mag
Cloudflare serverless rétegben fusson. Telegramon be lehessen adni, melyik
YouTube-videókat dolgozza fel. A kimenet egy weboldalon legyen olvasható,
bejelentkezés után. A jegyzet a GitHubon lévő Obsidian-vaultba is kerüljön.

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

A felosztás jó, de a magot nem egyetlen Worker-kérésbe kell áttenni. Egy videó
több modellhívás, a feliratletöltés folyamat, a vault helyi fájl és git. Egy
fetch-handler ezt nem bírja ki. A meglévő elv marad: a mag könyvtár, a Telegram
és a web ugyanaz a testvér, mint ma a CLI és a Nuxt.

```text
Telegram --webhook--> Worker (vékony)
                          |
                          v
                    Workflow (egy videó)
                     1. felirat
                     2. normalize / classify
                     3. receptenként refine
                     4. render
                     5. R2 + D1
                     6. GitHub commit
                          |
              +-----------+-----------+
              v                       v
     Pages olvasó (Access)     privát vault-repo
     bejelentkezés után        Obsidian Git húzza
```

A Telegram-bot csak parancsot fogad, és státuszt küld. A webhook titkosított, és
csak a saját chat-azonosító mehet át. Egy üzenet egy vagy több YouTube-cím; a bot
azonnal visszaírja, hogy sorba került, és a végén a jegyzet linkjét. Nem várja
meg a feldolgozást.

A Cloudflare-réteg:

| Darab | Szerep |
|---|---|
| Worker | webhook, olvasó API, semmi hosszú munka |
| Workflow | egy videó egy futás; lépésenként újrapróbálható, a CPU-limit nem vágja el a receptloopot |
| D1 | a mostani SQLite helye: elemek, műtermékek, költség, hiba. Állapot továbbra sem a vaultba megy |
| R2 | nyers felirat és kész Markdown. A web ezt olvassa, nem a GitHubot minden oldalnézetnél |
| Pages | olvasó felület |

A `normalize`, `classify`, `recipe`, `render` TypeScript marad, és a
Workflow-lépés importálja. A `node:fs`, a `chokidar` és a `node:sqlite` nem jön át.

## Ami nem Workers-natív

**Felirat.** A Worker nem tudja lefuttatni a mostani fetch-et. A
`src/fetch/subtitle/ytdlp.ts` folyamatot indít: `--skip-download --write-subs
--write-auto-subs --write-info-json`. A YouTube timedtext végpontja az
adatközponti IP-ket és a nem böngészős TLS-ujjlenyomatot gyakran elutasítja:
„not a bot”, vagy üres felirat a válasz. A lakossági gépről ugyanaz a `yt-dlp`
működik. A két út ezt a rést hidalja át; a csővezeték utána ugyanazt a `.vtt`-t
kapja. A hivatalos YouTube `captions.download` kiesik a személyes, idegen
videós útról: szerkesztési jogot kér, idegen videóra nem ad feliratot. A SaaS
saját-csatorna útján viszont ez a hivatalos hívás, lásd lent.

**Modell.** A Worker a helyi LiteLLM-et nem látja. Vagy a gateway publikus és
kulcsos, vagy a Workflow közvetlenül a providerhez beszél. A rubrika minősége
miatt ez nem Workers AI-ra cserélendő.

## Felirat: otthoni yt-dlp fallback

Egy vékony HTTP-szolgáltatás azon a gépen, ahol a `yt-dlp` ma is fut. A Workflow
először az edge-ről próbálja a feliratot. Ha 403, 429 vagy üres a törzs, ezt
hívja, és a választ az R2-be teszi.

A szerződés egy videó, nem egy parancssor:

```text
POST /subtitle
{ "url": "https://www.youtube.com/watch?v=...", "langs": ["hu", "en"] }

200
{ "id": "...", "title": "...", "channel": "...",
  "language": "hu", "kind": "creator" | "auto",
  "vtt": "...", "info": { } }
```

Belül a meglévő `videoProbeArgs` és `downloadArgs` fut, a kimenet a válaszba
kerül, nem a lemezre. A playlist-bontás marad a Workflowban: a szolgáltatás egy
videót szolgál ki, különben egy üzenet órákig tartja a folyamatot.

Elérni Cloudflare Tunnelen érdemes, nem portnyitással. A `cloudflared` kifelé
csatlakozik, a Worker a belső hosztnevet hívja. A hitelesítés Access service token
vagy egy hosszú közös titok a fejléchez. A végpont nem kerül nyilvános internetre,
és nem fogad tetszőleges shell-parancsot, csak YouTube-címet és nyelvkódot.

A gépnek fent kell lennie. Ha alszik, a Workflow a lépést átmeneti hibának veszi,
és később újrapróbálja. A Telegram addig azt írja, hogy a felirat a helyi
letöltőre vár. A `yt-dlp`-t pinnelni kell, és a `curl_cffi` extra is kell hozzá:
anélkül a metaadat megjön, a felirat viszont üres, mert a PO-tokenes kliensre esik
vissza.

Ez a kisebb eltérés a mostani kódtól. Ugyanaz a bináris, ugyanaz a formátum, nulla
feliratdíj. Az ára az, hogy a pipeline egy otthoni gépre vár. Személyes út, nem
a SaaS fetch-útja.

## Felirat: saját fetcher és lakossági proxy

A timedtext nem a videót kéri le, hanem a lejátszó felirat-URL-jét. A YouTube ezt
a hívást IP-hírnév alapján szűri: a felhős tartományokból jövő kérést gyakran üres
törzzsel vagy „not a bot” válasszal utasítja el. A proxy csak azt cseréli le,
melyik IP-ről látszik a kérés. A kód, a nyelvválasztás és a `.vtt` továbbra is saját.

```text
Workflow --> a saját fetcher --> proxykimenet --> youtube.com/api/timedtext
                 |                                      |
          videoazonosító, nyelv                    VTT vagy üres
                 |
                 +--> R2, ugyanaz a szerződés, mint a házi yt-dlp
```

A Worker maga rossz hely erre. Nincs `HTTP_PROXY` környezete, a kimenő IP-je
Cloudflare-tartomány. A fetcher ezért egy kis Node-folyamat, otthon vagy egy
olcsó gépen, és csak ő beszél a proxyval. A Workflow tőle a már leírt `/subtitle`
választ kapja.

Három címke van a piacon, és a név nem a viselkedés.

| Címke | Mi az IP | Timedtext |
|---|---|---|
| Datacenter | szerverteremben kiadott cím (AWS, GCP, olcsó proxyfarm) | ugyanaz a blokk, mint a Workerről: metaadat néha megjön, felirat nem |
| Static residential, ISP | fix cím, szolgáltatói tartományként árulva; gyakran adatközponti vas vagy kiégett készlet | tiszta, kis forgalmú cím néha átmegy; a költségvetős csomag a gyakorlatban ugyanabba a blokkba esik |
| Forgó lakossági | előfizetői kapcsolat, kérésenként vagy percenként másik cím | a timedtext nézőnek látja; egy felirat egymástól független kérés, ide ez való, nem egy napokig tartott fix cím |

A `youtube-transcript-api` fenntartói külön kimondják: lakossági terv, nem static
residential, nem datacenter, nem az ingyenes szint.

A forgalom apró. Egy felirat tíz–néhányszáz kilobájt, videó nélkül. A díj nem a
gigabájt, hanem a minimumcsomag: a lakossági forgalmat 2026 őszén nagyjából
4–8 dollár/GB-ért mérték, de egy személyes app havi néhány dolláros belépőből kijön,
mert a számlát a csomag alsó határa írja, nem a felirat. A videófájl proxyn át vitele
gigabájtos, azt nem szabad ide tenni.

Két kockázat marad, és egyik sem technikai hiba. A proxyszolgáltató feltétele
gyakran tiltja a botvédő megkerülését, és a YouTube-forgalmat külön kizárhatja;
egy tiltott használat a fiók zárása, nem egy 403. A YouTube feltételei az
automatizált letöltést eleve szürke zónába teszik. A mostani `yt-dlp` ugyanezt a
zónát használja, csak a saját lakossági IP-ről, proxycég nélkül. A proxy annyit
tesz hozzá, hogy más előfizetői címén megy ki a kérés, és azt a címet a
szolgáltató más ügyfelekkel is forgatja: ha ők kiégetik, a fetcher velük együtt bukik.

Erre a projektre ezért marad második választás. A saját otthoni `yt-dlp` ugyanazt
a lakossági IP-t használja, amit a YouTube már nézőként ismer, előfizetés és idegen
készlet nélkül. A proxy akkor éri meg, ha a gép alszik, és nincs hosztolt
transcript-API: egy kis fetcher, forgó lakossági kimenet, és ugyanaz a
`/subtitle` szerződés.

## Felirat: feliratszolgáltatás

Itt egy külső fél oldja meg az IP- és ujjlenyomat-problémát. A Workflow ugyanezt a
szerződést hívja, csak a hoszt nem a saját gép. A hosztolt transcript-API
videoazonosítót és nyelvet vár, VTT-t vagy json3-at ad. Nincs saját gép, nincs
`yt-dlp`. Cserébe hívásonként fizetendő, a szerzői és az automatikus felirat
megkülönböztetése a szolgáltatótól függ, és ha ők elromlanak vagy árat emelnek, a
fetch velük romlik. A rubrika ettől nem változik, de a bemenet minősége igen.

A szerződés legyen ugyanaz, mint a házi szolgáltatásé. Akkor a Workflow nem tudja,
melyik implementáció válaszolt, és a kettő egymás fallbackje lehet.

## Felirat: sorrend

Az edge-próba maradjon első, mert olcsó és néha elég. A második a házi `yt-dlp`:
a formátumot már a repó ismeri, a lakossági IP megvan, és egy személyes appnál a gép
ébrenléte vállalható. Szolgáltatást akkor érdemes elé tenni, ha a gép gyakran alszik,
vagy a feldolgozás nem függhet egy otthoni folyamattól. A kettő együtt is működik:
edge, utána szolgáltatás, utána házi `yt-dlp`, és csak a harmadik bukás „nincs
felirat”. Ez a személyes vezérlés sorrendje. A SaaS fetch-útja külön van, lent.

## Olvasó oldal

Saját logint nem érdemes építeni. Cloudflare Access, email egyszeri kóddal, egyetlen
engedélyezett címmel. A Pages a D1-ből listáz, az R2-ből rendereli a jegyzetet. A
mostani Nuxt szerződése marad: a web nem indít futást, azt a Telegram teszi.

## Vault

A vault külön privát repo, nem a `transcript-refinery` repó. A mostani szabályok
maradnak: csak az `Inbox/transcript-refinery/` alá ír, write-once, nincs force
push, csak a ténylegesen írt útvonalak kerülnek commitba. A GitHub Contents API
vagy egy Git-tree commit csinálja, fine-grained tokennel, csak arra a repóra. Az
Obsidian Git-plugin húzza. Ha ugyanazt a jegyzetet közben kézzel szerkesztik, a
pipeline nem írja felül.

## Szeletek

Mindegyik külön bizonyítja, hogy a következő nem felesleges:

1. Bot és D1-sor, a feldolgozás még a meglévő CLI. Ezzel a vezérlés kész.
2. Egy Workflow, egy recept (`summary`), eredmény R2-ben, link a Telegramban.
3. Olvasó oldal Access mögött.
4. GitHub-commit a vaultba, utána a többi recept és a költségplafon.

A playlist későbbre marad: a bot egy listát szétbont videó-Workflow-kra, különben
egy üzenet órákig tart.

## Jogszerű SaaS

A jogi határ nem a Cloudflare és nem a login. A határ az, hogy a felirat honnan jön,
és kinek a műve. A személyes bot, ami tetszőleges YouTube-címet `yt-dlp`-vel vagy
proxyn át leszed, ebből a formából nem lesz jogszerű SaaS. A finomító mag igen.

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
   csatornát, amin szerkeszthet. A Workflow csak `captions.download`-ot hív,
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

A személyes bot megmaradhat a saját gépen, a saját vaultra. A SaaS a másik
szerződés: feltöltés vagy saját csatorna OAuth, Cloudflare Access vagy rendes
fiók, D1-ben ügyfélenként elkülönített állapot, R2-ben az ő fájlja. A recept, a
rubrika és a render változatlan.

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

Ez a három döntés változtatja a vázat. A beszélgetés feltételezte, hogy mindhárom
igen, de nincs rájuk válasz:

- a vault már létező privát repo-e, amit az Obsidian Git szinkronizál;
- a LiteLLM marad-e a modellút, vagy a Workflow közvetlenül a providerhez beszél;
- csak egy olvasója van-e az oldalnak.

A felirat sorrendje sem eldöntött. A jegyzet alapállása a személyes útra: edge,
utána házi `yt-dlp`, szolgáltatás csak ha a gép ébrenléte nem vállalható. A SaaS
fetch-útja külön: feltöltött felirat vagy saját csatorna, hivatalos
`captions.download`.
