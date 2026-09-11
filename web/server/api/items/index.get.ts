import { readItems } from 'transcript-refinery'

export default defineEventHandler(() => coreHandler((cfg) => readItems(cfg)))
