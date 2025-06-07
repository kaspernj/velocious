import fs from "node:fs/promises"

const fileExists = async (path) => {
  try {
    await fs.access(path)

    return true
  } catch (error) {
    return false
  }
}

export default fileExists
