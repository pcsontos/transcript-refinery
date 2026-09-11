import { readItemDetail } from 'transcript-refinery'

export default defineEventHandler((event) =>
  coreHandler(async (cfg) => {
    const itemId = getRouterParam(event, 'itemId', { decode: true }) ?? ''
    const detail = await readItemDetail(cfg, itemId)
    if (!detail) throw createError({ statusCode: 404, message: 'Nincs ilyen elem.' })
    return {
      ...detail,
      artifacts: detail.artifacts.map((artifact) => ({
        ...artifact,
        html: artifact.body === null ? null : renderMarkdown(artifact.body),
        obsidianUrl:
          artifact.path === null
            ? null
            : `obsidian://open?path=${encodeURIComponent(artifact.path)}`,
      })),
    }
  }),
)
