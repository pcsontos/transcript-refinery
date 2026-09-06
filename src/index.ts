export {
  CONFIG_FILENAME,
  DEFAULT_NOTES_DIR,
  loadConfig,
  loadDotEnv,
  loadModelConfig,
  readConfigFile,
  validateConfig,
  type Config,
  type ModelConfig,
  type SourceDir,
} from './config.js'
export { discoverAll, folderSource } from './source/folder.js'
export { itemIdFor } from './source/identity.js'
export { mapInfoJson, readSidecar, type SidecarData } from './source/metadata.js'
export { renderFrontmatter, type FrontmatterField } from './vault/frontmatter.js'
export type { CaptionSource, Cue, ItemMetadata, NormalizedTranscript, SourceItem } from './types.js'
export { collectEvents, summarize, type EventSink, type RunEvent } from './events.js'
export { processItem, type ItemOutcome, type PipelineDeps } from './pipeline.js'
export type { Source } from './source/types.js'
export { openState, type StateStore } from './state/db.js'
export { normalizeItem, type RecipeDeps } from './pipeline.js'
export { getRecipe, RECIPES, RECIPE_IDS } from './recipe/registry.js'
export type { Recipe, RecipeInput } from './recipe/types.js'
export { refine, type RefineResult } from './refine/loop.js'
export { createModelClient, modelClientFrom, type ModelClient } from './model/client.js'
