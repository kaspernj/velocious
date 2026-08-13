// @ts-check

import path from "path"
import {fileURLToPath} from "url"

/** @returns {string} - Repository root. */
export default function repoRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
}
