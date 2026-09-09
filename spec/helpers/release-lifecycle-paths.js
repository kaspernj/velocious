// @ts-check

import fs from "node:fs/promises"
import path from "node:path"
import dummyConfiguration from "../dummy/src/config/configuration.js"

/** @returns {Promise<{directory: string, socketPath: string}>} - Owned release-local lifecycle paths. */
export default async function releaseLifecyclePaths() {
  const tmpRoot = path.join(dummyConfiguration.getDirectory(), "tmp")
  await fs.mkdir(tmpRoot, {recursive: true})
  const directory = await fs.mkdtemp(path.join(tmpRoot, "generation-control-"))

  return {directory, socketPath: path.join(directory, "main.sock")}
}
