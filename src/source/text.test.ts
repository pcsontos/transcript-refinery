import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { lintVaultMarkdown } from '../vault/lint.js'
import { readTextSource, stripFrontmatter, textItemId, vaultSafeLinks } from './text.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'refinery-text-'))
})

async function file(name: string, content: string | Buffer): Promise<string> {
  const path = join(dir, name)
  await writeFile(path, content)
  return path
}

describe('stripFrontmatter', () => {
  it('a záró ----ig levágja a vezető frontmattert', () => {
    expect(stripFrontmatter('---\ntitle: X\n---\n# Fejezet\nszöveg')).toBe('# Fejezet\nszöveg')
  })

  it('a ... záró sort is elfogadja', () => {
    expect(stripFrontmatter('---\ntitle: X\n...\nszöveg')).toBe('szöveg')
  })

  it('záró sor nélkül nem vág', () => {
    expect(stripFrontmatter('---\nnem frontmatter\nszöveg')).toBe('---\nnem frontmatter\nszöveg')
  })

  it('ha nem ---- sorral kezdődik, nem vág', () => {
    expect(stripFrontmatter('szöveg\n---\nx\n---')).toBe('szöveg\n---\nx\n---')
  })
})

describe('vaultSafeLinks', () => {
  it('a wikilinkből a felirat vagy a cél marad, a link célja csúcsos zárójelbe kerül', () => {
    const out = vaultSafeLinks('Lásd [[Cél|felirat]], [[Másik]], [itt](https://pelda.hu/a b) és ![kép](<x.png>).')
    expect(out).toBe('Lásd felirat, Másik, [itt](<https://pelda.hu/a b>) és ![kép](<x.png>).')
    expect(lintVaultMarkdown(out)).toEqual([])
  })
})

describe('readTextSource és textItemId', () => {
  it('a CRLF, a BOM és a szélek whitespace-e nem változtat az azonosítón', async () => {
    const a = await readTextSource(await file('a.txt', 'Első sor.\nMásodik sor.\n'))
    const b = await readTextSource(await file('b.txt', '﻿  Első sor.\r\nMásodik sor.\r\n\r\n'))
    expect(a).toBe('Első sor.\nMásodik sor.')
    expect(textItemId(b)).toBe(textItemId(a))
  })

  it('egy betű eltérés új azonosító', async () => {
    const a = await readTextSource(await file('a.txt', 'Első sor.'))
    const b = await readTextSource(await file('b.txt', 'Elsö sor.'))
    expect(textItemId(a)).not.toBe(textItemId(b))
    expect(textItemId(a)).toMatch(/^t-[0-9a-f]{16}$/)
  })

  it('.md-nél a frontmatter lekerül, és a hash utána készül', async () => {
    const a = await readTextSource(await file('a.md', '---\ntitle: Egy\n---\n# Fejezet\n'))
    const b = await readTextSource(await file('b.md', '---\ntitle: Kettő\n---\n# Fejezet\n'))
    expect(a).toBe('# Fejezet')
    expect(textItemId(a)).toBe(textItemId(b))
  })

  it('.txt-nél a frontmatternek látszó rész marad', async () => {
    expect(await readTextSource(await file('a.txt', '---\nx\n---\ny'))).toBe('---\nx\n---\ny')
  })

  it('megnevezett hibák: üres, csak frontmatter, túl nagy, NUL-bájt, érvénytelen UTF-8', async () => {
    await expect(readTextSource(await file('u.txt', ' \n\n'))).rejects.toThrow('a fájl üres')
    await expect(readTextSource(await file('f.md', '---\na: 1\n---\n'))).rejects.toThrow('a fájl üres')
    await expect(readTextSource(await file('n.txt', 'a'.repeat(2 * 1024 * 1024 + 1)))).rejects.toThrow(
      'a fájl túl nagy: 2.0 MB, legfeljebb 2 MB',
    )
    await expect(readTextSource(await file('z.txt', 'a\0b'))).rejects.toThrow('a fájl nem UTF-8 szöveg')
    await expect(readTextSource(await file('r.txt', Buffer.from([0xc3, 0x28])))).rejects.toThrow(
      'a fájl nem UTF-8 szöveg',
    )
  })
})
