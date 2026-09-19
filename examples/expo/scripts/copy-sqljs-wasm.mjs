import { copyFile } from "node:fs/promises"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const sqlJsDistributionDirectory = path.dirname(require.resolve("sql.js"))
const exportDirectory = fileURLToPath(new URL("../dist/", import.meta.url))

await Promise.all([
  "sql-wasm.wasm",
  "sql-wasm-browser.wasm"
].map(async (filename) => {
  await copyFile(
    path.join(sqlJsDistributionDirectory, filename),
    path.join(exportDirectory, filename)
  )
}))
