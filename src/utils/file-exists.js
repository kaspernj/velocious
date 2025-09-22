import fs from "node:fs/promises"

async function fileExists(path) {
  try {
    await fs.access(path)

    return true
  } catch (error) {
    return false
  }
}

export default fileExists
