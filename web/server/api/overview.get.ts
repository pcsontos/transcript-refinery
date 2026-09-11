import { readOverview } from 'transcript-refinery'

export default defineEventHandler(() => coreHandler((cfg) => readOverview(cfg)))
