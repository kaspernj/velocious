import path from "node:path"
import process from "node:process"
import {spawn} from "node:child_process"
import {fileURLToPath} from "node:url"

/** Runs the Velocious test command from the dummy app with cross-platform env setup. */
async function main() {
  const __filename = fileURLToPath(import.meta.url)
  const scriptsDirectory = path.dirname(__filename)
  const projectDirectory = path.resolve(scriptsDirectory, "..")
  const dummyDirectory = path.join(projectDirectory, "spec", "dummy")
  const testDirectory = path.resolve(dummyDirectory, "..")
  const cliPath = path.join(projectDirectory, "bin", "velocious.js")
  const args = ["test", ...process.argv.slice(2)]

  await new Promise((resolve, reject) => {
    const childProcess = spawn(process.execPath, [cliPath, ...args], {
      cwd: dummyDirectory,
      env: {...process.env, VELOCIOUS_TEST_DIR: testDirectory},
      stdio: "inherit"
    })

    childProcess.once("error", reject)
    childProcess.once("close", (code, signal) => {
      if (signal) {
        reject(new Error(`Test process terminated by signal: ${signal}`))
        return
      }

      // A non-zero exit without the runner's own failure summary is the
      // "silent test-runner death" mode (e.g. a hard process.exit or native
      // crash). Always print the exit code so CI logs show that the child
      // died rather than ending the log mid-run with no explanation.
      if (code !== 0) console.error(`Test process exited with code: ${code ?? "unknown"}`)

      resolve(code ?? 1)
    })
  }).then((code) => {
    process.exit(/** @type {number} */ (code))
  })
}

await main()
