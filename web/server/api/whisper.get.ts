import { watcherWarning, whisperDirs } from 'transcript-refinery'

/** A whisper-figyelő figyelmeztetése a /runs sávjához; `null`, ha friss az életjel vagy a whisper ki van kapcsolva. */
export default defineEventHandler(() =>
  coreHandler(async (cfg) => {
    const dirs = await whisperDirs(cfg)
    return { warning: dirs === null ? null : await watcherWarning(dirs) }
  }),
)
