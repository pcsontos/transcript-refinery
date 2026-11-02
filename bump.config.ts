import { defineConfig } from 'bumpp'

export default defineConfig({
  commit: 'chore: {tag} kiadás',
  tag: 'v{version}',
  files: ['package.json', 'web/package.json'],
})
