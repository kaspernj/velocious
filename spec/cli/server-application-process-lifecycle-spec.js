// @ts-check

import { spawn } from "node:child_process"
import path from "node:path"

import { describe, expect, it, waitForEvent } from "../../src/testing/test.js"
import { createApplicationProcessLifecycleProject } from "../helpers/application-process-lifecycle-project.js"
import repoRoot from "../helpers/repo-root.js"

const CLI_ENTRY_PATH = path.join(repoRoot(), "bin", "velocious.js")

describe("Server application process lifecycle", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("tears the server and worker-handler lifecycles down once on SIGTERM", async () => {
    const project = await createApplicationProcessLifecycleProject()
    const child = spawn(process.execPath, [CLI_ENTRY_PATH, "server", "--port", "0", "--workers", "1"], {
      cwd: project.directory,
      env: {...process.env, VELOCIOUS_ENV: "test"},
      stdio: ["ignore", "pipe", "inherit"]
    })

    try {
      if (!child.stdout) throw new Error("Server child stdout was not piped")
      await waitForEvent(child.stdout, "data", {
        filter: (chunk) => String(chunk).includes("Started Velocious HTTP server"),
        timeoutMs: 5000
      })
      const exit = waitForEvent(child, "exit", {timeoutMs: 5000})
      child.kill("SIGTERM")
      await exit

      expect(child.signalCode).toBe(null)
      expect(child.exitCode).toEqual(0)
      expect((await project.readEvents()).map(({phase, type}) => `${phase}:${type}`)).toEqual([
        "start:server",
        "start:worker-handler",
        "teardown:worker-handler",
        "teardown:server"
      ])
    } finally {
      if (child.exitCode === null && !child.killed) child.kill("SIGKILL")
      await project.cleanup()
    }
  })
})
