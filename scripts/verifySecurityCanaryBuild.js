import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptDirectory, '..')
const indexPath = path.join(repositoryRoot, 'dist', 'index.html')
const expectedMarker = '<meta name="sprc-security-bootstrap" content="v3-enabled">'

export async function verifySecurityCanaryBuild() {
  const html = await readFile(indexPath, 'utf8')
  if (!html.includes(expectedMarker)) {
    throw new Error('Refusing security-canary release: the built Hosting bundle does not declare secure bootstrap v3 enabled.')
  }
  return { indexPath, marker: 'v3-enabled' }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifySecurityCanaryBuild()
    .then(result => console.log(JSON.stringify({ securityCanaryBuildVerified: true, ...result }, null, 2)))
    .catch(error => {
      console.error(error.message)
      process.exitCode = 1
    })
}
