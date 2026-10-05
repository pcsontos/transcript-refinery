import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('szállítási fájlok', () => {
  it('a Dockerfile a Node 26.2 képről indul, és a serve parancsot futtatja', async () => {
    const docker = await readFile('Dockerfile', 'utf8')
    expect(docker).toContain('node:26.2')
    expect(docker).toContain('yt-dlp')
    expect(docker).toContain('CMD ["refinery", "serve"]')
  })

  it('a wrangler percenként fut, és a D1 kötés neve DB', async () => {
    const toml = await readFile('worker/wrangler.toml', 'utf8')
    expect(toml).toContain('crons = ["* * * * *"]')
    expect(toml).toContain('binding = "DB"')
    const sql = await readFile('worker/migrations/0001_jobs.sql', 'utf8')
    expect(sql).toContain('CREATE TABLE jobs')
    expect(sql).toContain('update_id')
    expect(sql).toContain('notified_ready')
  })
})
