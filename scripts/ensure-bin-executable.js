import fs from "node:fs/promises"
import path from "node:path"

/** Ensures the built CLI entrypoint has execute permissions on POSIX. */
async function main() {
  if (process.platform === "win32") return

  const binPath = path.join("build", "bin", "velocious.js")

  await fs.chmod(binPath, 0o755)
}

await main()
