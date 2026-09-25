import { readReports } from 'transcript-refinery'

export default defineEventHandler(() => coreHandler((cfg) => readReports(cfg)))
