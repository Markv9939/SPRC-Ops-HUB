import process from 'node:process'
import { build } from 'vite'
import { verifySecurityCanaryBuild } from './verifySecurityCanaryBuild.js'

process.env.VITE_ENABLE_SECURITY_BOOTSTRAP_V3 = 'true'

await build()
const evidence = await verifySecurityCanaryBuild()
console.log(JSON.stringify({ securityCanaryBuildCompleted: true, ...evidence }, null, 2))
