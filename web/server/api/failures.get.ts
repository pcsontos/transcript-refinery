import { readFailures } from 'transcript-refinery'

export default defineEventHandler(() => coreHandler((cfg) => readFailures(cfg)))
