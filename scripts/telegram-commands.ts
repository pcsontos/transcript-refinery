// A Telegram `/` menüjét a `/help` listájára állítja (BOT_COMMANDS), majd visszaolvassa.
// Használat: pnpm telegram:commands [--dry-run]
// A token a TELEGRAM_BOT_TOKEN; a pnpm-parancs a worker/.dev.vars-ból tölti (--env-file-if-exists). Nem írja ki.
import { BOT_COMMANDS } from '../worker/src/messages.js'

const commands = BOT_COMMANDS.map(({ command, description }) => ({ command, description }))

async function call(method: string, body: unknown = {}): Promise<unknown> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) throw new Error('Nincs TELEGRAM_BOT_TOKEN (környezet vagy worker/.dev.vars).')
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const reply = (await response.json()) as { ok: boolean; result?: unknown; description?: string }
  if (!reply.ok) throw new Error(`${method}: ${reply.description ?? String(response.status)}`)
  return reply.result
}

if (process.argv.includes('--dry-run')) {
  console.log(JSON.stringify(commands, null, 2))
} else {
  await call('setMyCommands', { commands })
  console.log(JSON.stringify(await call('getMyCommands'), null, 2))
}
