// SQL fájl a helyi vagy az éles D1-en.
// Használat: pnpm exec tsx scripts/query.ts --host local|remote --sql lekerdezes.sql
// Az éles adatbázison csak SELECT (vagy WITH) futhat.
import { spawnSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

const USAGE = 'Használat: pnpm exec tsx scripts/query.ts --host local|remote --sql lekerdezes.sql'

export function assertRemoteReadOnly(sql: string): void {
  const statements = splitSql(sql).map((statement) => statement.trim()).filter(Boolean)
  if (statements.length === 0) throw new Error('Üres SQL.')
  for (const statement of statements) {
    const word = /^[A-Za-z_]+/.exec(statement)?.[0]?.toUpperCase()
    if (word !== 'SELECT' && word !== 'WITH') throw new Error('Az éles adatbázison csak SELECT futhat.')
  }
}

function splitSql(sql: string): string[] {
  const statements: string[] = []
  let current = ''
  for (let i = 0; i < sql.length; i++) {
    const char = sql[i]
    const next = sql[i + 1]
    if (char === '-' && next === '-') {
      while (i < sql.length && sql[i] !== '\n') i++
      continue
    }
    if (char === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2)
      if (end < 0) throw new Error('Érvénytelen SQL.')
      i = end + 1
      continue
    }
    if (char === "'" || char === '"') {
      const end = quotedEnd(sql, i)
      current += sql.slice(i, end)
      i = end - 1
      continue
    }
    if (char === ';') {
      statements.push(current)
      current = ''
      continue
    }
    current += char
  }
  statements.push(current)
  return statements
}

function quotedEnd(sql: string, start: number): number {
  const quote = sql[start]
  for (let i = start + 1; i < sql.length; i++) {
    if (sql[i] === quote) {
      if (sql[i + 1] === quote) {
        i++
        continue
      }
      return i + 1
    }
  }
  throw new Error('Érvénytelen SQL.')
}

function main(): void {
  const { host, sqlPath } = readArgs()
  if (host === 'remote') {
    try {
      assertRemoteReadOnly(readFileSync(sqlPath, 'utf8'))
    } catch (error) {
      fail(error instanceof Error ? error.message : 'Érvénytelen SQL.')
    }
  }
  const args = [
    'wrangler',
    'd1',
    'execute',
    'transcript-refinery',
    host === 'local' ? '--local' : '--remote',
    '--config',
    'worker/wrangler.toml',
    '--file',
    sqlPath,
  ]
  if (host === 'remote') args.push('--yes')
  const result = spawnSync('npx', args, { cwd: resolve(import.meta.dirname, '..'), stdio: 'inherit' })
  process.exit(result.status ?? 1)
}

function readArgs(): { host: 'local' | 'remote'; sqlPath: string } {
  let host: string | undefined
  let sql: string | undefined
  try {
    const values = parseArgs({
      options: { host: { type: 'string' }, sql: { type: 'string' } },
      strict: true,
    }).values
    host = values.host
    sql = values.sql
  } catch {
    fail(USAGE)
  }
  if (host !== 'local' && host !== 'remote') fail(USAGE)
  if (!sql) fail('A --sql egy létező fájl legyen.')
  try {
    if (statSync(sql).size === 0) fail('Üres SQL.')
  } catch {
    fail('A --sql egy létező fájl legyen.')
  }
  return { host, sqlPath: resolve(sql) }
}

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
