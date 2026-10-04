# Telegram-vezérlés, Cloudflare-mag, olvasó oldal, vault-commit

Jegyzet egy 2026-10-04-i tervezőbeszélgetésről. Nem döntésrekord és nem
implementációs terv: a kérdést, a mostani kódra támaszkodó választ és a nyitott
pontokat rögzíti. Implementáció nem indult.

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

**Felirat.** A `refinery fetch subtitle` ma `yt-dlp`-t indít. Az edge-ről a
YouTube timedtext gyakran elhasal. Első körben egy caption-HTTP hívás a
Workflowban, és ha 403 jön, egy otthoni `yt-dlp` fallback vagy egy
feliratszolgáltatás. Enélkül a bot csak „nincs felirat” üzeneteket küld.

**Modell.** A Worker a helyi LiteLLM-et nem látja. Vagy a gateway publikus és
kulcsos, vagy a Workflow közvetlenül a providerhez beszél. A rubrika minősége
miatt ez nem Workers AI-ra cserélendő.

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

## Nyitott pontok

Ez a három döntés változtatja a vázat. A beszélgetés feltételezte, hogy mindhárom
igen, de nincs rájuk válasz:

- a vault már létező privát repo-e, amit az Obsidian Git szinkronizál;
- a LiteLLM marad-e a modellút, vagy a Workflow közvetlenül a providerhez beszél;
- csak egy olvasója van-e az oldalnak.
