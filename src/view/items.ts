import { readFile } from 'node:fs/promises'
import type { Config } from '../config.js'
import { RECIPES } from '../recipe/registry.js'
import { discoverAll } from '../source/folder.js'
import type { ArtifactRow, ItemRow } from '../state/queries.js'
import { openStateReader } from '../state/reader.js'
import type { CaptionSource, SourceItem } from '../types.js'
import { artifactKinds } from './overview.js'

export type CellStatus = 'done' | 'failed' | 'pending'

/** Egy elem egy műtermék-típusának állapota a listában. */
export interface ItemCell {
  status: CellStatus
  score: number | null
  costUsd: number | null
  /** Kész, pontozott, és a recept küszöbe alatt maradt. */
  belowThreshold: boolean
}

export interface ItemListRow {
  itemId: string
  title: string
  source: string
  channel: string | null
  captionSource: CaptionSource | null
  /** Megvan-e még a felirat a forrásmappában. */
  discovered: boolean
  /** A legutóbbi műtermék-rögzítés ideje. */
  updatedAt: string | null
  /** Műtermék-típusonként egy cella, az `artifactKinds()` kulcsaival. */
  cells: Record<string, ItemCell>
}

function cellStatus(status: string | undefined): CellStatus {
  return status === 'done' || status === 'failed' ? status : 'pending'
}

function thresholdOf(kind: string): number | null {
  return RECIPES[kind]?.rubric.passThreshold ?? null
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/**
 * Az elemlista: a felderített elemek felderítési sorrendben, utánuk azok, amelyek
 * csak az állapottárban vannak (a feliratuk azóta eltűnt), cím szerint.
 */
export function buildItemRows(
  discovered: readonly SourceItem[],
  items: readonly ItemRow[],
  artifacts: readonly ArtifactRow[],
): ItemListRow[] {
  const rowOf = new Map(items.map((row) => [row.itemId, row] as const))
  const artifactsOf = new Map<string, ArtifactRow[]>()
  for (const artifact of artifacts) {
    const list = artifactsOf.get(artifact.itemId) ?? []
    list.push(artifact)
    artifactsOf.set(artifact.itemId, list)
  }
  const kinds = artifactKinds()

  const toRow = (
    itemId: string,
    title: string,
    source: string,
    channel: string | null,
    isDiscovered: boolean,
  ): ItemListRow => {
    const own = artifactsOf.get(itemId) ?? []
    const cells: Record<string, ItemCell> = {}
    for (const kind of kinds) {
      const artifact = own.find((a) => a.kind === kind)
      const status = cellStatus(artifact?.status)
      const score = artifact?.score ?? null
      const threshold = thresholdOf(kind)
      cells[kind] = {
        status,
        score,
        costUsd: artifact?.costUsd ?? null,
        belowThreshold: status === 'done' && threshold !== null && score !== null && score < threshold,
      }
    }
    const times = own.map((a) => a.createdAt).sort()
    return {
      itemId,
      title,
      source,
      channel,
      captionSource: rowOf.get(itemId)?.captionSource ?? null,
      discovered: isDiscovered,
      updatedAt: times.at(-1) ?? null,
      cells,
    }
  }

  const seen = new Set<string>()
  const rows = discovered.map((item) => {
    seen.add(item.itemId)
    const channel = item.metadata.channel ?? rowOf.get(item.itemId)?.channel ?? null
    return toRow(item.itemId, item.title, item.source, channel, true)
  })
  const missing = items
    .filter((row) => !seen.has(row.itemId))
    .sort((a, b) => byText(a.title, b.title))
    .map((row) => toRow(row.itemId, row.title, row.source, row.channel, false))
  return [...rows, ...missing]
}

export async function readItems(
  cfg: Pick<Config, 'sources' | 'languages' | 'statePath'>,
): Promise<ItemListRow[]> {
  const discovered = await discoverAll(cfg.sources, cfg.languages)
  const reader = openStateReader(cfg.statePath)
  try {
    return buildItemRows(discovered, reader?.items() ?? [], reader?.artifacts() ?? [])
  } finally {
    reader?.close()
  }
}

/** A jegyzet törzse a YAML-frontmatter nélkül; frontmatter nélküli szöveget változatlanul ad. */
export function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^---\n[\s\S]*?\n---\n?/, '')
}

/** Egy rögzített műtermék az elem oldalán. */
export interface ArtifactDetail {
  kind: string
  status: CellStatus
  path: string | null
  error: string | null
  iterations: number | null
  score: number | null
  costUsd: number | null
  model: string | null
  createdAt: string
  /** A recept küszöbe; az átiratnál `null`. */
  threshold: number | null
  /** A bíró hiánylistája; `null`, ha nincs rögzítve. */
  gaps: string[] | null
  /** A jegyzet Markdown-törzse frontmatter nélkül; `null`, ha nincs fájl. */
  body: string | null
  /** Az állapottár szerint kész, de a fájl nem található. */
  missingFile: boolean
}

export interface ItemDetail {
  item: {
    itemId: string
    title: string
    source: string
    sourceFile: string | null
    channel: string | null
    url: string | null
    uploadedAt: string | null
    captionSource: CaptionSource | null
    wordsRaw: number | null
    wordsNormalized: number | null
    /** Megvan-e még a felirat a forrásmappában. */
    discovered: boolean
  }
  /** A rögzített műtermékek, az `artifactKinds()` sorrendjében. */
  artifacts: ArtifactDetail[]
}

async function readNote(path: string | null): Promise<{ body: string | null; missing: boolean }> {
  if (path === null) return { body: null, missing: false }
  try {
    return { body: stripFrontmatter(await readFile(path, 'utf8')), missing: false }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { body: null, missing: true }
    throw error
  }
}

/**
 * Egy elem minden adata az elem oldalához. Jegyzetfájlt kizárólag az
 * állapottárban rögzített útról olvas — soha nem a kérésből kapott értékből.
 * Ismeretlen elemre `null`.
 */
export async function readItemDetail(
  cfg: Pick<Config, 'sources' | 'languages' | 'statePath'>,
  itemId: string,
): Promise<ItemDetail | null> {
  const discovered = (await discoverAll(cfg.sources, cfg.languages)).find(
    (item) => item.itemId === itemId,
  )
  const reader = openStateReader(cfg.statePath)
  try {
    const row = reader?.items().find((item) => item.itemId === itemId)
    if (!discovered && !row) return null

    const own = (reader?.artifacts() ?? []).filter((a) => a.itemId === itemId)
    const artifacts: ArtifactDetail[] = []
    for (const kind of artifactKinds()) {
      const artifact = own.find((a) => a.kind === kind)
      if (!artifact) continue
      const status = cellStatus(artifact.status)
      const note =
        status === 'done' ? await readNote(artifact.path) : { body: null, missing: false }
      artifacts.push({
        kind,
        status,
        path: artifact.path,
        error: artifact.error,
        iterations: artifact.iterations,
        score: artifact.score,
        costUsd: artifact.costUsd,
        model: artifact.model,
        createdAt: artifact.createdAt,
        threshold: thresholdOf(kind),
        gaps: reader?.gapsOf(itemId, kind) ?? null,
        body: note.body,
        missingFile: note.missing,
      })
    }

    return {
      item: {
        itemId,
        title: discovered?.title ?? row?.title ?? itemId,
        source: discovered?.source ?? row?.source ?? '',
        sourceFile: discovered?.sourceFile ?? row?.sourceFile ?? null,
        channel: discovered?.metadata.channel ?? row?.channel ?? null,
        url: discovered?.metadata.url ?? row?.url ?? null,
        uploadedAt: discovered?.metadata.uploadedAt ?? row?.uploadedAt ?? null,
        captionSource: row?.captionSource ?? null,
        wordsRaw: row?.wordsRaw ?? null,
        wordsNormalized: row?.wordsNormalized ?? null,
        discovered: discovered !== undefined,
      },
      artifacts,
    }
  } finally {
    reader?.close()
  }
}
