import { access, readdir, readFile, rm } from 'node:fs/promises'
import { basename, join, relative, sep } from 'node:path'
import { commandRun, type RunRuntime } from '../cli.js'
import { loadCliConfig, loadModelConfig, type Config } from '../config.js'
import { deployLines, deployNotes } from '../deploy/deploy.js'
import { mdxTransformFor } from '../deploy/llm.js'
import { progressText, type RunEvent as CoreEvent } from '../events.js'
import type { LanguageTag } from '../lang/identify.js'
import { assertOverrideModels, withRecipeModels } from '../model/recipe-model.js'
import { glossaryKind } from '../recipe/glossary.js'
import { recipesFor } from '../recipe/registry.js'
import { DEFAULT_CHUNK_WORDS } from '../recipe/split.js'
import { discoverAll, splitSubtitleName } from '../source/folder.js'
import { isTextItemId, TEXT_EXTENSIONS } from '../source/text.js'
import { openState, type ArtifactSnapshot } from '../state/db.js'
import { noteCommitMessage } from '../vault/commit.js'
import type { NoteOrigin } from '../vault/render.js'
import { gitCommitPaths, gitPullFfOnly, gitPush, gitRestorePaths } from '../vault/git.js'
import type { CallbackBody, RecipesOutcome } from './job.js'

type SummaryGit = {
  pull(repo: string): Promise<void>
  commit(repo: string, paths: readonly string[], message: string): Promise<boolean>
  push(repo: string): Promise<{ pushed: boolean }>
  /** Fájlok visszaállítása a HEAD-re (megszakított újragenerálás). */
  restore(repo: string, paths: readonly string[]): Promise<void>
}

const defaultGit: SummaryGit = {
  pull: gitPullFfOnly,
  commit: gitCommitPaths,
  push: gitPush,
  restore: gitRestorePaths,
}

/** Az állapottár szerint kész jegyzet fájlja hiányzik a vaultból (pcsontos/issue-tracker#84): a teendő az Újragenerálás, nem automatikus újrafuttatás. */
export const MISSING_NOTE = 'A jegyzet korábban elkészült, de nincs meg a vaultban.'

/** A megszakított futás üzenete: a Worker nem küld belőle másodikat, a bot a „Megszakítva” sort már elküldte. */
export const CANCELLED_RUN = 'Megszakítva, a jegyzet nem került a vaultba.'

type RunEvent = { type?: string; reason?: string; spentUsd?: number; limitUsd?: number; error?: string; timedOut?: boolean }

export function firstLine(text: string): string {
  const line = text.split('\n').find((item) => item.trim() !== '')
  return line?.trim() ?? ''
}

async function logNames(logsDir: string): Promise<string[]> {
  try {
    return (await readdir(logsDir)).filter((name) => name.endsWith('.jsonl'))
  } catch {
    return []
  }
}

/**
 * Az e futás alatt született napló eseményei. Név szerint nem lehet a legutolsót
 * venni: egy másodpercen belüli második futás `<id>-2.jsonl`, ami a `<id>.jsonl` elé rendeződik.
 */
async function runEvents(logsDir: string, before: ReadonlySet<string>): Promise<RunEvent[]> {
  const latest = (await logNames(logsDir)).find((name) => !before.has(name))
  if (latest === undefined) return []
  const text = await readFile(join(logsDir, latest), 'utf8')
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as RunEvent)
}

/** A futás naplójából a Telegramnak szóló mondat: plafon, hiba, kihagyás, ebben a sorrendben. */
function failureLine(events: readonly RunEvent[], fallback: string): string {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === 'run:aborted' && typeof event.reason === 'string') {
      const spent = typeof event.spentUsd === 'number' ? event.spentUsd : 0
      const limit = typeof event.limitUsd === 'number' ? event.limitUsd : 0
      return `A futás megállt: ${event.reason} (${spent.toFixed(4)} $ / ${limit.toFixed(4)} $)`
    }
  }
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type === 'item:failed' && typeof event.error === 'string') {
      const line = firstLine(event.error)
      return line === '' ? fallback : line
    }
  }
  const skipped = events.findLast((event) => event.type === 'item:skipped' && typeof event.reason === 'string')
  return skipped?.reason ?? fallback
}

async function keepThisVideo(outDir: string, videoId: string): Promise<void> {
  const names = await readdir(outDir)
  await Promise.all(
    names
      .filter((name) => !name.includes(videoId))
      .map((name) => rm(join(outDir, name), { recursive: true, force: true })),
  )
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/**
 * Megszakított futás visszagörgetése (pcsontos/issue-tracker#83): a tétel olyan, mintha a futás meg sem történt volna.
 * Új sor → a fájl és a sor törlődik; force-szal felülírt recept → a commitolt fájl és a régi sor visszaáll.
 */
async function rollbackRun(
  cfg: Config,
  git: SummaryGit,
  videoId: string,
  kinds: readonly string[],
  before: ReadonlyMap<string, ArtifactSnapshot | null>,
  forceRecipe: boolean,
  glossary: string | null,
): Promise<void> {
  const store = openState(cfg.statePath, cfg.vaultPath)
  try {
    for (const kind of kinds) {
      const snapshot = before.get(kind) ?? null
      const current = store.artifactOf(videoId, kind)
      const wasDone = snapshot?.row.status === 'done'
      if (kind === glossary) {
        // A szójegyzék a fordítással jön létre, force nélkül is újraíródhat: a `wasDone`-kihagyás nem érvényes rá (pcsontos/issue-tracker#109).
        // ponytail: a kézzel betett, állapotsor nélküli szójegyzéket a megszakítás törli; ha ez gond lesz, a futás előtti `git ls-files --others` halmaz a bővítés útja.
        const path = current?.path ?? null
        if (path !== null) {
          if (wasDone) {
            // Követetlen fájlnál a restore hibát ad: ahhoz nem nyúlunk, `rm` nincs.
            await git.restore(cfg.vaultPath, [path]).catch(() => undefined)
          } else {
            await rm(path, { force: true })
          }
        }
        store.restoreArtifact(videoId, kind, snapshot)
        continue
      }
      if (wasDone && !(forceRecipe && kind !== 'transcript')) continue
      if (wasDone) {
        const path = current?.path ?? null
        if (path !== null) {
          try {
            await git.restore(cfg.vaultPath, [path])
          } catch {
            await rm(path, { force: true })
          }
        }
      } else if (current?.status === 'done' && current.path !== null) {
        await rm(current.path, { force: true })
      } else {
        continue
      }
      store.restoreArtifact(videoId, kind, snapshot)
    }
  } finally {
    store.close()
  }
}

export async function runRecipes(input: {
  videoId: string
  outDir: string
  recipes: readonly string[]
  lang?: LanguageTag
  createClient?: RunRuntime['createClient']
  git?: SummaryGit
  load?: () => Promise<{ cfg: Config; raw: unknown }>
  /** A `serve` cancel végpontjának jele: a futás a következő egység előtt áll meg. */
  signal?: AbortSignal
  /** Életjel és leállás a futás közben, rögtön (nem a futás végén). */
  notify?: (body: CallbackBody) => void
  /** A Worker felülírása; a YAML `model.recipes` fölé kerül. */
  models?: Readonly<Record<string, string>>
  /** A showroom-deploy; a teszt hamisat ad. */
  deploy?: typeof deployNotes
  /** Csak a recept jegyzetét írja újra (Újragenerálás); az átirat és a `done` sora érintetlen. */
  forceRecipe?: boolean
  /** A jegyzet eredete: `cli` esetén a config forrásneve alá kerül, nem a munkamappa neve alá (pcsontos/issue-tracker#85). */
  origin?: NoteOrigin
  /** A futásnapló parancsa; alapból `serve recipes`, átírás utáni futásnál `after-whisper <id>`. */
  command?: string
}): Promise<RecipesOutcome> {
  const git = input.git ?? defaultGit
  let loaded: { cfg: Config; raw: unknown }
  try {
    loaded = input.load ? await input.load() : await loadCliConfig(undefined)
  } catch (error) {
    const message = error instanceof Error ? firstLine(error.message) : ''
    return { ok: false, error: message === '' ? 'A futás megállt.' : message }
  }
  const lang = input.lang
  const cfg: Config = {
    ...loaded.cfg,
    sources: [{ name: input.origin === 'cli' ? loaded.cfg.sources[0]!.name : basename(input.outDir), path: input.outDir }],
    // A célnyelv a kérésé, nem a configé: a futás idejére a kért forrásokból lesz fordítórecept.
    ...(lang === undefined
      ? {}
      : {
          translate: {
            to: lang,
            recipes: [...input.recipes],
            chunkWords: loaded.cfg.translate?.chunkWords ?? DEFAULT_CHUNK_WORDS,
          },
        }),
  }
  // A felülírást a vault-pull és a modellhívás előtt ellenőrizzük: hibás kérésnél egyik sem történik.
  const models = input.models ?? {}
  const raw = withRecipeModels(loaded.raw, models)
  if (Object.keys(models).length > 0) {
    try {
      assertOverrideModels(loadModelConfig(raw, process.env, cfg.configPath), recipesFor(cfg), models)
    } catch (error) {
      return { ok: false, error: firstLine(error instanceof Error ? error.message : String(error)) }
    }
  }
  try {
    await git.pull(loaded.cfg.vaultPath)
  } catch {
    return { ok: false, error: 'A vault frissítése nem sikerült.' }
  }
  const ids = lang === undefined ? [...input.recipes] : input.recipes.map((id) => `${id}-${lang}`)
  await keepThisVideo(input.outDir, input.videoId)
  // A szöveges tétel az A szelet `--file` útján fut: a `sources` csak feliratot vesz fel.
  // Csak szöveges azonosítóra, és a `[<azonosító>]` utótagra: egy régi szöveg címében
  // szereplő videóazonosító nem vihet el egy videó futását.
  const textName = isTextItemId(input.videoId)
    ? (await readdir(input.outDir)).find(
        (name) => name.includes(`[${input.videoId}]`) && splitSubtitleName(name, TEXT_EXTENSIONS) !== null,
      )
    : undefined
  const logsBefore = new Set(await logNames(cfg.logsDir))
  // A visszagörgetés alapja (pcsontos/issue-tracker#83): az érintett sorok a futás előtt. A `done` sor esemény nélkül is születhet
  // („a fájl már létezik” kihagyás), ezért a tárból veszünk pillanatképet, nem az eseményekből.
  const glossary = lang === undefined ? null : glossaryKind(lang)
  const rollbackKinds = ['transcript', ...ids, ...(glossary === null ? [] : [glossary])]
  const before = new Map<string, ArtifactSnapshot | null>()
  const snapStore = openState(cfg.statePath, cfg.vaultPath)
  try {
    for (const kind of rollbackKinds) before.set(kind, snapStore.snapshotArtifact(input.videoId, kind))
  } finally {
    snapStore.close()
  }
  // A futásidő-korlát miatt leállt receptek: az első üzenete lesz a hiba, a többi kész jegyzet marad.
  const stalled = new Map<string, string>()
  const onEvent = (event: CoreEvent): void => {
    if (event.type === 'item:progress') input.notify?.({ status: 'progress', text: progressText(event) })
    if (event.type === 'item:failed' && event.timedOut === true) {
      stalled.set(event.kind, event.error)
      input.notify?.({ status: 'stalled', text: `${firstLine(event.error)} Újra próbáljam?` })
    }
  }
  const code = await commandRun(
    cfg,
    raw,
    {
      recipes: ids,
      dryRun: false,
      force: false,
      ...(input.forceRecipe === true ? { forceRecipe: true } : {}),
      commit: false,
      command: [input.command ?? 'serve recipes', ...Object.entries(models).map(([id, model]) => `${id}=${model}`)].join(' '),
      origin: input.origin ?? 'telegram',
      ...(textName === undefined ? {} : { adHoc: { file: join(input.outDir, textName) } }),
    },
    { createClient: input.createClient, signal: input.signal, onEvent },
  )
  if (input.signal?.aborted === true) {
    await rollbackRun(cfg, git, input.videoId, rollbackKinds, before, input.forceRecipe === true, glossary)
    return { ok: false, error: CANCELLED_RUN }
  }
  const events = await runEvents(cfg.logsDir, logsBefore)
  const names = await readdir(input.outDir)
  const fileName =
    textName ??
    names.find((name) => {
      const parsed = splitSubtitleName(name)
      return parsed !== null && parsed.base.includes(input.videoId)
    })
  const parsed =
    fileName === undefined ? null : (splitSubtitleName(fileName) ?? splitSubtitleName(fileName, TEXT_EXTENSIONS))
  // A commitolandó utak a tárból jönnek, nem újraszámolásból: az elem mappája az első kimenetnél rögzül.
  const store = openState(cfg.statePath, cfg.vaultPath)
  let transcriptPath: string | null
  let notePaths: (string | null)[]
  let glossaryPath: string | null = null
  try {
    const stored = (kind: string): string | null => store.artifactOf(input.videoId, kind)?.path ?? null
    transcriptPath = stored('transcript')
    notePaths = ids.map(stored)
    if (glossary !== null) glossaryPath = stored(glossary)
  } finally {
    store.close()
  }
  if (transcriptPath !== null && parsed !== null) {
    // A cím az info.json-ból jön, ha a letöltés írt ilyet; különben a fájl alapneve.
    const found = (await discoverAll(cfg.sources, cfg.languages)).find((item) => item.baseName === parsed.base)
    const title = found?.title ?? parsed.base
    // Jegyzetenként külön commit, az üzenetben a fajtával: az átirat elöl, utána a receptek.
    const kinds = ['transcript', ...ids, ...(glossary === null ? [] : [glossary])]
    for (const [index, path] of [transcriptPath, ...notePaths, ...(glossary === null ? [] : [glossaryPath])].entries()) {
      if (path !== null && (await exists(path))) {
        await git.commit(cfg.vaultPath, [path], noteCommitMessage(kinds[index]!, title, input.videoId))
      }
    }
  }
  const pushed = await git.push(cfg.vaultPath)
  if (!pushed.pushed) return { ok: false, error: 'A push nem sikerült, a commit lokálisan maradt.' }
  // Az `auto` deploy a jelentés (`ready`/`failed`) után fut, a `followUp`-ban: az LLM-es átalakítás percekig
  // tarthat, a válasz nem vár rá. A hibája nem buktatja a jobot: a jegyzet a vaultban megvan, a
  // `refinery deploy` pótolja. A site-link addig 404-et adhat. Átírás utáni futásnál (#45) a `runRecipeJob`
  // a jelentés előtt hívja.
  const followUp =
    cfg.showroom?.deploy === 'auto'
      ? async (): Promise<string | void> => {
          try {
            const transform = mdxTransformFor(loaded.raw, cfg, input.createClient)
            if (typeof transform === 'string') console.log(`[deploy] LLM-átalakítás nélkül: ${transform}`)
            const itemIds = new Set([input.videoId])
            const report = await (input.deploy ?? deployNotes)({
              cfg,
              itemIds,
              ...(typeof transform === 'string' ? {} : { transform }),
            })
            for (const line of deployLines(report)) console.log(`[deploy] ${line.replace(/^deploy: /, '')}`)
            // A push hibája a jelentésben van, nem dob; az átírás utáni üzenet a visszatérési értékből tudja (#45).
            if (report.push !== null && !report.push.pushed) return 'a showroom-push nem sikerült'
          } catch (error) {
            const message = firstLine(error instanceof Error ? error.message : String(error))
            console.warn(`[deploy] sikertelen: ${message}`)
            return message
          }
        }
      : undefined
  const finish = (outcome: RecipesOutcome): RecipesOutcome => (followUp === undefined ? outcome : { ...outcome, followUp })
  // Ha a leállás mellett más recept közönséges hibával bukott, az a hibasorba kerül (a leállásról a rákérdezés már szólt):
  // a `done` nélküli, hagyományos hibaút a hibát mondja, nem csak a leállást.
  const otherFailure = events.some((event) => event.type === 'item:failed' && event.timedOut !== true)
  if (stalled.size > 0 && !otherFailure) {
    const done: string[] = []
    for (const [index, id] of ids.entries()) {
      const path = notePaths[index]
      if (!stalled.has(id) && path != null && (await exists(path))) done.push(id)
    }
    return finish({ ok: false, error: firstLine([...stalled.values()][0]!), done })
  }
  if (code !== 0) {
    const reported = stalled.size > 0 ? events.filter((event) => !(event.type === 'item:failed' && event.timedOut === true)) : events
    return finish({ ok: false, error: failureLine(reported, 'A futás megállt.') })
  }
  if (transcriptPath === null) return finish({ ok: false, error: 'A jegyzet nem készült el.' })
  for (const path of notePaths) {
    if (path === null) return finish({ ok: false, error: failureLine(events, 'A jegyzet nem készült el.') })
    // A sor `done` (különben nem volna útja), de a fájl nincs meg: a futás „már feldolgozva” miatt hagyta ki.
    if (!(await exists(path))) return finish({ ok: false, error: MISSING_NOTE, missing: true })
  }
  // A vaulton belüli út forge-független: a Worker nem olvassa, csak eltárolja.
  const noteUrl = relative(cfg.vaultPath, transcriptPath).split(sep).join('/')
  return finish({ ok: true, noteUrl })
}
