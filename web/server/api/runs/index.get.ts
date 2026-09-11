import { readRuns } from 'transcript-refinery'

export default defineEventHandler(() => coreHandler((cfg) => readRuns(cfg)))
