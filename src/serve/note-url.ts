const REMOTE = /^(?:git@github\.com:|https:\/\/github\.com\/)([^/]+)\/([^/]+?)(?:\.git)?$/

export function githubNoteUrl(remote: string, branch: string, vaultRelativePath: string): string | null {
  const match = REMOTE.exec(remote.trim())
  if (match?.[1] === undefined || match[2] === undefined) return null
  const segments = vaultRelativePath.split('/').filter((segment) => segment !== '').map(encodeURIComponent)
  return `https://github.com/${match[1]}/${match[2]}/blob/${encodeURIComponent(branch)}/${segments.join('/')}`
}
