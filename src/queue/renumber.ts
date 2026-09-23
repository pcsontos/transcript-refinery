/** A csoportfejléc sorszám-előtagja; a kulcs nem lehet üres. */
const GROUP = /^## \d+\. (?=.)/
/** A videófejléc sorszám-előtagja; csak horgonnyal együtt videó. */
const VIDEO = /^### \d+\. (?=.*? %%.+?%%)/

/**
 * A `N. ` előtag újraírása: a csoportok a jegyzeten végig, a videók
 * csoportonként 1-től. A sorszám a pipeline-é, mint az utótag; a fejléc többi
 * része és minden más sor bájtra érintetlen. Idempotens.
 */
export function renumberQueue(text: string): string {
  let group = 0
  let video = 0
  return text
    .split('\n')
    .map((line) => {
      if (GROUP.test(line)) {
        group++
        video = 0
        return line.replace(GROUP, `## ${String(group)}. `)
      }
      if (VIDEO.test(line)) {
        video++
        return line.replace(VIDEO, `### ${String(video)}. `)
      }
      return line
    })
    .join('\n')
}
