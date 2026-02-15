import fs from "node:fs/promises"

/** Removes the generated build directory. */
async function main() {
  await fs.rm("build", {recursive: true, force: true})
}

await main()
