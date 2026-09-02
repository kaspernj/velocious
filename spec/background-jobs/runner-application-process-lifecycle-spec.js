// @ts-check

import { fork } from "node:child_process"
import net from "node:net"
import { fileURLToPath } from "node:url"

import JsonSocket from "../../src/background-jobs/json-socket.js"
import { describe, expect, it, waitForEvent } from "../../src/testing/test.js"
import { createApplicationProcessLifecycleProject } from "../helpers/application-process-lifecycle-project.js"

const FORKED_RUNNER_ENTRY_PATH = fileURLToPath(new URL("../../src/background-jobs/forked-runner-child.js", import.meta.url))
const POOLED_RUNNER_ENTRY_PATH = fileURLToPath(new URL("../../src/background-jobs/pooled-runner-child.js", import.meta.url))

/**
 * @param {import("node:child_process").ChildProcess} child - Runner child.
 * @param {(message: ReturnType<typeof JSON.parse>) => boolean} predicate - Message matcher.
 * @returns {Promise<ReturnType<typeof JSON.parse>>} - Matching message.
 */
async function waitForChildMessage(child, predicate) {
  let matchingMessage

  await waitForEvent(child, "message", {
    filter: (message) => {
      if (!predicate(message)) return false
      matchingMessage = message
      return true
    },
    timeoutMs: 5000
  })

  return matchingMessage
}

/**
 * @param {import("node:child_process").ChildProcess} child - Runner child.
 * @returns {Promise<void>} - Resolves when the child exits.
 */
async function waitForChildExit(child) {
  await waitForEvent(child, "exit", {timeoutMs: 5000})
}

/**
 * @param {string} directory - Temporary project directory.
 * @param {string} entryPath - Child entrypoint.
 * @returns {import("node:child_process").ChildProcess} - Spawned runner.
 */
function spawnRunner(directory, entryPath) {
  return fork(entryPath, [], {
    cwd: directory,
    execArgv: [],
    stdio: ["ignore", "ignore", "inherit", "ipc"]
  })
}

/** @returns {Promise<{close: () => Promise<void>, port: number}>} - Fake durable status server. */
async function startStatusServer() {
  const server = net.createServer((socket) => {
    const jsonSocket = new JsonSocket(socket)

    jsonSocket.on("message", (message) => {
      if (!message || typeof message !== "object") return
      if (!["job-complete", "job-failed", "job-reschedule"].includes(message.type)) return

      jsonSocket.send({type: "job-updated", jobId: message.jobId})
    })
  })

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Status server did not bind to a TCP port")

  return {
    close: async () => await new Promise((resolve) => server.close(() => resolve(undefined))),
    port: address.port
  }
}

/** @param {string} id - Job id. @param {"block" | "complete"} mode - Job mode. */
function jobMessage(id, mode = "complete") {
  return {
    type: "job",
    payload: {
      args: [mode],
      id,
      jobName: "ProcessLifecycleJob"
    }
  }
}

describe("Background-job runner application process lifecycle", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("reuses one pooled lifecycle across jobs and gives a replacement a new identity", async () => {
    const statusServer = await startStatusServer()
    const project = await createApplicationProcessLifecycleProject({backgroundJobsPort: statusServer.port})
    /** @type {import("node:child_process").ChildProcess | undefined} */
    let child
    /** @type {import("node:child_process").ChildProcess | undefined} */
    let replacement

    try {
      child = spawnRunner(project.directory, POOLED_RUNNER_ENTRY_PATH)
      await waitForChildMessage(child, (message) => message?.type === "ready")

      for (const jobId of ["pooled-1", "pooled-2"]) {
        const outcome = waitForChildMessage(child, (message) => message?.type === "job-outcome" && message.jobId === jobId)
        child.send(jobMessage(jobId))
        expect((await outcome).status).toEqual("completed")
      }

      const activeEvents = await project.readEvents()
      expect(activeEvents.map(({phase, type}) => `${phase}:${type}`)).toEqual([
        "start:background-jobs-pooled-runner"
      ])

      const firstExit = waitForChildExit(child)
      child.disconnect()
      await firstExit

      const firstLifecycleEvents = await project.readEvents()
      expect(firstLifecycleEvents.map(({phase}) => phase)).toEqual(["start", "teardown"])

      replacement = spawnRunner(project.directory, POOLED_RUNNER_ENTRY_PATH)
      await waitForChildMessage(replacement, (message) => message?.type === "ready")
      const replacementOutcome = waitForChildMessage(replacement, (message) => message?.type === "job-outcome" && message.jobId === "pooled-3")
      replacement.send(jobMessage("pooled-3"))
      await replacementOutcome
      const replacementExit = waitForChildExit(replacement)
      replacement.kill("SIGTERM")
      await replacementExit

      const events = await project.readEvents()
      expect(events.map(({phase, type}) => `${phase}:${type}`)).toEqual([
        "start:background-jobs-pooled-runner",
        "teardown:background-jobs-pooled-runner",
        "start:background-jobs-pooled-runner",
        "teardown:background-jobs-pooled-runner"
      ])
      expect(events[2].instanceId === events[0].instanceId).toBe(false)
    } finally {
      if (child?.exitCode === null && !child.killed) child.kill("SIGKILL")
      if (replacement?.exitCode === null && !replacement.killed) replacement.kill("SIGKILL")
      await statusServer.close()
      await project.cleanup()
    }
  })

  it("tears a forked lifecycle down after durable completion acknowledgement", async () => {
    const statusServer = await startStatusServer()
    const project = await createApplicationProcessLifecycleProject({backgroundJobsPort: statusServer.port})
    const child = spawnRunner(project.directory, FORKED_RUNNER_ENTRY_PATH)

    try {
      const reported = waitForChildMessage(child, (message) => message?.type === "job-reported")
      const exited = waitForChildExit(child)
      child.send(jobMessage("forked-complete"))
      await reported
      await exited

      expect((await project.readEvents()).map(({phase, type}) => `${phase}:${type}`)).toEqual([
        "start:background-jobs-forked-runner",
        "teardown:background-jobs-forked-runner"
      ])
    } finally {
      if (child.exitCode === null && !child.killed) child.kill("SIGKILL")
      await statusServer.close()
      await project.cleanup()
    }
  })

  it("tears forked lifecycles down on SIGTERM and disconnect", async () => {
    const statusServer = await startStatusServer()
    const project = await createApplicationProcessLifecycleProject({backgroundJobsPort: statusServer.port})

    try {
      for (const termination of ["SIGTERM", "disconnect"]) {
        const child = spawnRunner(project.directory, FORKED_RUNNER_ENTRY_PATH)

        try {
          const started = waitForChildMessage(child, (message) => message?.type === "perform-started")
          child.send(jobMessage(`forked-${termination}`, "block"))
          await started
          const exited = waitForChildExit(child)

          if (termination === "SIGTERM") {
            child.kill("SIGTERM")
          } else {
            child.disconnect()
          }
          await exited
        } finally {
          if (child.exitCode === null && !child.killed) child.kill("SIGKILL")
        }
      }

      expect((await project.readEvents()).map(({phase, type}) => `${phase}:${type}`)).toEqual([
        "start:background-jobs-forked-runner",
        "teardown:background-jobs-forked-runner",
        "start:background-jobs-forked-runner",
        "teardown:background-jobs-forked-runner"
      ])
    } finally {
      await statusServer.close()
      await project.cleanup()
    }
  })
})
