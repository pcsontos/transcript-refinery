import { describe, expect, it } from 'vitest'
import { parseSubtitleArgs } from './args.js'

describe('parseSubtitleArgs', () => {
  it('egy cím és célmappa, a formátum alapból vtt,srt', () => {
    const parsed = parseSubtitleArgs(['https://youtu.be/abcdefghijk', '--out', '/tmp/felirat'])
    expect(parsed).toEqual({
      ok: true,
      args: {
        inputs: ['https://youtu.be/abcdefghijk'],
        out: '/tmp/felirat',
        subLang: undefined,
        subFormat: ['vtt', 'srt'],
        listPath: undefined,
        overwrite: false,
        flat: false,
        playlistItems: undefined,
        yesPlaylist: false,
        config: undefined,
      },
    })
  })

  it('a nyelv kisbetűsödik, a lista útvonal megmarad', () => {
    const parsed = parseSubtitleArgs(['--sub-lang', 'HU,en-US', '--list', 'lista.txt'])
    expect(parsed.ok && parsed.args.inputs).toEqual([])
    expect(parsed.ok && parsed.args.listPath).toBe('lista.txt')
    expect(parsed.ok && parsed.args.subLang).toEqual(['hu', 'en-US'])
  })

  it('cím és --list együtt, és egyik híján is, hiba', () => {
    expect(parseSubtitleArgs(['https://youtu.be/abcdefghijk', '--list', 'a.txt'])).toEqual({
      ok: false,
      error: 'Adj meg egy címet vagy egy --list fájlt, a kettőt együtt nem.',
    })
    expect(parseSubtitleArgs(['--out', '/tmp/felirat'])).toEqual({
      ok: false,
      error: 'Adj meg egy címet vagy egy --list fájlt.',
    })
    expect(parseSubtitleArgs(['elso', 'masodik'])).toEqual({
      ok: false,
      error: 'Egy cím adható meg.',
    })
  })

  it('a relatív --out, a hibás nyelv és a dupla formátum hiba', () => {
    expect(parseSubtitleArgs(['abcdefghijk', '--out', 'relatív'])).toEqual({
      ok: false,
      error: 'A --out abszolút útvonal kell legyen.',
    })
    expect(parseSubtitleArgs(['abcdefghijk', '--sub-lang', 'all'])).toEqual({
      ok: false,
      error: 'A --sub-lang eleme nyelvkód, például hu vagy en-US.',
    })
    expect(parseSubtitleArgs(['abcdefghijk', '--sub-format', 'vtt,vtt'])).toEqual({
      ok: false,
      error: 'A --sub-format egy formátumot csak egyszer tartalmazhat.',
    })
    expect(parseSubtitleArgs(['abcdefghijk', '--sub-format', 'srt,best'])).toEqual({
      ok: false,
      error: 'A --sub-format csak vtt és srt lehet.',
    })
  })

  it('a --force ismeretlen kapcsoló', () => {
    expect(parseSubtitleArgs(['abcdefghijk', '--force'])).toEqual({
      ok: false,
      error: 'Ismeretlen kapcsoló: --force',
    })
  })

  it('a --sub-format sorrendje megmarad', () => {
    const parsed = parseSubtitleArgs(['abcdefghijk', '--sub-format', 'srt,vtt'])
    expect(parsed.ok && parsed.args.subFormat).toEqual(['srt', 'vtt'])
  })
})
