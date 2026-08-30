import { mkdir, writeFile } from 'node:fs/promises'
import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname } from 'node:path'

export interface PublishOptions {
  force?: boolean
  dryRun?: boolean
}

export interface PublishResult {
  status: 'written' | 'skipped'
  path: string
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Write-once fájlírás. A vaultban évek kézi munkája van; létező fájlt
 * kizárólag explicit `force` mellett írunk felül.
 */
export async function publishNote(
  filePath: string,
  content: string,
  opts: PublishOptions,
): Promise<PublishResult> {
  if (!opts.force && (await exists(filePath))) {
    return { status: 'skipped', path: filePath }
  }
  if (opts.dryRun) {
    return { status: 'written', path: filePath }
  }
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, content, 'utf8')
  return { status: 'written', path: filePath }
}
