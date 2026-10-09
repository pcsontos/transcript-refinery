/**
 * A CLI súgója. Ebből a táblázatból készül az áttekintés (`refinery help`) és
 * a parancsonkénti súgó (`refinery help <parancs>`, `refinery <parancs> --help`),
 * így a kettő nem csúszhat el egymástól.
 */
export interface CommandHelp {
  name: string
  summary: string
  usage: string
  description: string
  options: readonly (readonly [string, string])[]
  examples: readonly string[]
}

const CONFIG = ['--config <út>', 'konfigurációs fájl (alapértelmezés: refinery.config.yaml)'] as const
const HELP = ['--help, -h', 'megjeleníti ezt a súgót'] as const
const SOURCE = ['--source <név>', 'csak a megadott forrásmappából'] as const
const CHANNEL = ['--channel <név>', 'csak a megadott csatorna (metaadat nélküli elemre nem illik)'] as const
const LIMIT = ['--limit <szám>', 'legfeljebb ennyi elem'] as const
const NO_COMMIT = ['--no-commit', 'nem commitol és nem pushol a vault repójába'] as const

export const COMMANDS: readonly CommandHelp[] = [
  {
    name: 'scan',
    summary: 'Felderíti a feldolgozható videókat, és nem ír semmit.',
    usage: 'refinery scan [kapcsolók]',
    description:
      'Felderíti a forrásmappák feldolgozható videóit, és kiírja őket.\n' +
      'A --queue mellett a vault _queue.md sorába fésüli az új tételeket.',
    options: [
      CONFIG,
      ['--queue', 'a vault _queue.md sorába fésül'],
      ['--dry-run', '--queue mellett: nem írja a sort, csak kiírja a változást'],
      ['--no-commit', '--queue mellett: nem commitol és nem pushol a vault repójába'],
      HELP,
    ],
    examples: ['refinery scan', 'refinery scan --queue --dry-run'],
  },
  {
    name: 'run',
    summary: 'Átiratot készít és a vaultba írja.',
    usage: 'refinery run [kapcsolók]',
    description:
      'Átiratot készít a feldolgozható videókból, és a vaultba írja.\n' +
      'A --recipe receptet is futtat; a --queue a vault _queue.md sorának kipipált párjait dolgozza fel.\n' +
      'A futás naplója és riportja a konfigurációban megadott logs.dir alá kerül.',
    options: [
      CONFIG,
      SOURCE,
      CHANNEL,
      LIMIT,
      ['--recipe <id>', 'receptet is futtat (pl. summary); enélkül csak átirat'],
      ['--queue', 'a sor kipipált (videó, recept) párjait dolgozza fel'],
      ['--dry-run', 'nem ír fájlt és nem rögzít állapotot; recepttel a modellhívások VALÓS költséggel megtörténnek'],
      [
        '--force',
        'létező fájlt is felülír; --queue mellett a sor minden kipipált párját, a késznek jelölteket is újrafuttatja',
      ],
      NO_COMMIT,
      ['--retry-failed', 'csak a korábban hibára futott elemek'],
      ['--no-judge', 'a bíró pontozói nem futnak (a determinisztikus kapuk igen); felülírja a model.judge_enabled beállítást'],
      HELP,
    ],
    examples: ['refinery run --limit 3', 'refinery run --recipe summary --limit 1', 'refinery run --queue'],
  },
  {
    name: 'check-pricing',
    summary: 'Összeveti a config árazását a LiteLLM élő áraival.',
    usage: 'refinery check-pricing [kapcsolók]',
    description: 'Összeveti a konfiguráció modellárazását a LiteLLM élő áraival, és kiírja az eltéréseket.',
    options: [CONFIG, ['--fix', 'a talált árazási eltéréseket visszaírja a konfigurációs fájlba'], HELP],
    examples: ['refinery check-pricing', 'refinery check-pricing --fix'],
  },
  {
    name: 'list',
    summary: 'Kilistázza az elemeket típusonkénti állapottal; nem ír semmit.',
    usage: 'refinery list [kapcsolók]',
    description: 'Kilistázza a feldolgozott elemeket típusonkénti állapottal. Nem ír semmit.',
    options: [
      CONFIG,
      SOURCE,
      CHANNEL,
      ['--recipe <id>', 'csak ennek a típusnak az állapota'],
      ['--status <érték>', 'done, failed vagy pending; --recipe nélkül bármely típusra illik'],
      ['--channels', 'csatornánkénti összesítő'],
      LIMIT,
      HELP,
    ],
    examples: ['refinery list --status failed', 'refinery list --channels'],
  },
  {
    name: 'fetch subtitle',
    summary: 'YouTube-feliratot és .info.json fájlt tölt egy mappába.',
    usage:
      'refinery fetch subtitle <url|id> [kapcsolók]\n' + '           refinery fetch subtitle --list <fájl> [kapcsolók]',
    description:
      'YouTube-feliratot és .info.json metaadatot tölt egy helyi mappába a yt-dlp segítségével.\n' +
      'Ami már ott van, azt átugorja. A run és a watch nem hívja.',
    options: [
      ['--out <út>', 'célmappa, abszolút; hiányában a config első sources eleme'],
      ['--list <fájl>', 'soronkénti címek; a # sor és az üres sor kimarad'],
      ['--sub-lang <kód>', 'vesszős nyelvkódok; alap a config languages, vagy hu,en'],
      ['--sub-format <f>', 'vtt és srt, vesszővel; alap: vtt,srt'],
      ['--overwrite', 'meglévő felirat és .info.json újraírása'],
      ['--flat', 'minden fájl az --out gyökerébe'],
      ['--playlist-items <elemek>', 'lista szűrése, a yt-dlp -I értékeként'],
      ['--yes-playlist', 'a watch?v=&list= cím a teljes listát jelenti'],
      CONFIG,
      HELP,
    ],
    examples: [
      'refinery fetch subtitle https://www.youtube.com/watch?v=<id>',
      'refinery fetch subtitle --list videok.txt --out /abs/mappa',
    ],
  },
  {
    name: 'serve',
    summary: 'A Worker munkáit fogadó démon: felirat az R2-be, receptek a vaultba.',
    usage: 'refinery serve [kapcsolók]',
    description:
      'A Worker POST /jobs kéréseit fogadja: a videó feliratát és info.json fájlját az R2-be tölti,\n' +
      'a receptfuttatások jegyzeteit a vaultba írja.\n' +
      'Végpontok: GET /ping és GET /version hitelesítés nélkül, GET /status a REFINERY_SERVE_SECRET Bearer-tokenjével.\n' +
      '\n' +
      'Kötelező környezeti változók: REFINERY_SERVE_SECRET, WORKER_CALLBACK_URL, SERVE_OUT,\n' +
      '  R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY\n' +
      'Opcionális: SERVE_PORT (alap: 8787), SERVE_HOST (alap: 127.0.0.1), REFINERY_SUB_LANG',
    options: [
      ['--config <út>', 'konfigurációs fájl; ha meg van adva és nem tölthető be, a serve el sem indul'],
      HELP,
    ],
    examples: ['refinery serve', 'refinery serve --config /abs/refinery.config.yaml'],
  },
  {
    name: 'watch',
    summary: 'Figyeli a forrásmappákat; az új feliratból átirat és _queue.md-sor lesz.',
    usage: 'refinery watch [kapcsolók]',
    description:
      'Figyeli a forrásmappákat: az új feliratból átirat és _queue.md-sor lesz; modellt nem hív.\n' +
      'Leállítás: Ctrl+C. Csak az itt felsorolt kapcsolókat ismeri.',
    options: [CONFIG, ['--source <név>', 'csak a megadott forrásmappát figyeli'], NO_COMMIT, HELP],
    examples: ['refinery watch', 'refinery watch --no-commit'],
  },
  {
    name: 'version',
    summary: 'Kiírja a verziószámot.',
    usage: 'refinery version',
    description: 'Kiírja a refinery verziószámát. Ugyanezt adja a --version kapcsoló bármely parancs mellett.',
    options: [HELP],
    examples: ['refinery version', 'refinery --version'],
  },
  {
    name: 'help',
    summary: 'Súgó: áttekintés vagy egy parancs részletei.',
    usage: 'refinery help [parancs]',
    description:
      'Paraméter nélkül a parancsok áttekintését adja, paraméterrel az adott parancs súgóját.\n' +
      'Ugyanezt adja a refinery <parancs> --help.',
    options: [],
    examples: ['refinery help run', 'refinery help fetch subtitle'],
  },
]

function table(rows: readonly (readonly [string, string])[]): string[] {
  const width = Math.max(...rows.map(([left]) => left.length)) + 2
  return rows.map(([left, right]) => `  ${left.padEnd(width)}${right}`)
}

export function overview(): string {
  return [
    'refinery <parancs> [kapcsolók]',
    '',
    'Parancsok:',
    ...table(COMMANDS.map((command) => [command.name, command.summary] as const)),
    '',
    'Általános kapcsolók:',
    ...table([HELP, ['--version', 'kiírja a verziószámot']]),
    '',
    'Részletek: refinery help <parancs>',
  ].join('\n')
}

export function helpText(name: string): string | undefined {
  const command = COMMANDS.find((item) => item.name === name)
  if (command === undefined) return undefined
  const lines = [`Használat: ${command.usage}`, '', command.description]
  if (command.options.length > 0) lines.push('', 'Kapcsolók:', ...table(command.options))
  lines.push('', 'Példák:', ...command.examples.map((example) => `  ${example}`))
  return lines.join('\n')
}
