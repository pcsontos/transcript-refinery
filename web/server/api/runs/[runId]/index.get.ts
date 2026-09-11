import { readRun } from 'transcript-refinery'

export default defineEventHandler((event) =>
  coreHandler(async (cfg) => {
    const run = await readRun(cfg, getRouterParam(event, 'runId', { decode: true }) ?? '')
    if (!run) throw createError({ statusCode: 404, message: 'Nincs ilyen futás.' })
    return { ...run, reportHtml: run.report === null ? null : renderMarkdown(run.report) }
  }),
)
