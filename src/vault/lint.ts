import { parse as parseYaml } from 'yaml'

const WIKILINK = /\[\[[^\]]+\]\]/g
const MARKDOWN_LINK = /!?\[[^\]]*\]\(([^)]*)\)/g
const FRONTMATTER = /^---\n([\s\S]*?)\n---(?:\n|$)/

/**
 * A vault írási szabályai invariánsok, nem konvenciók: wikilink tilos, minden
 * link célja szögletes zárójelben áll, és — ha van frontmatter — az
 * értelmezhető YAML. Ez utóbbi a második védvonal: a `renderFrontmatter`
 * hibája (pl. rosszul behúzott blokk-skalár) enélkül némán jutna ki a
 * vaultba, mert a pipeline a lint-hibát alakítja kivétellé, nem a YAML-parse
 * hibáját közvetlenül. Hibalistát ad; üres lista = jó.
 */
export function lintVaultMarkdown(md: string): string[] {
  const errors: string[] = []

  for (const m of md.matchAll(WIKILINK)) {
    errors.push(`wikilink tiltott: ${m[0]}`)
  }

  for (const m of md.matchAll(MARKDOWN_LINK)) {
    const dest = m[1]!
    if (!(dest.startsWith('<') && dest.endsWith('>'))) {
      errors.push(`a link célja nem szögletes zárójelben áll: ${m[0]}`)
    }
  }

  const frontmatterMatch = FRONTMATTER.exec(md)
  if (frontmatterMatch) {
    try {
      parseYaml(frontmatterMatch[1]!)
    } catch (error) {
      errors.push(`a frontmatter nem értelmezhető YAML: ${(error as Error).message}`)
    }
  }

  return errors
}
