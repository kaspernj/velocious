// @ts-check

import BackgroundJobsWorker from "../../src/background-jobs/worker.js"
import {describe, expect, it} from "../../src/testing/test.js"

/**
 * Creates a worker with the minimal stubbed configuration the child-spawn
 * helpers read, without forking a process or touching a database.
 * @returns {BackgroundJobsWorker} - Worker under test.
 */
function buildWorker() {
  const worker = new BackgroundJobsWorker({host: "127.0.0.1", pooledRunnerCount: 1, port: 7331})

  worker.configuration = /** @type {ReturnType<typeof JSON.parse>} */ ({getEnvironment: () => "test"})

  return worker
}

describe("Background jobs - runner child memory caps", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("caps runner child V8 heap and glibc arenas by default", () => {
    const worker = buildWorker()

    expect(worker._childRunnerExecArgv()).toEqual(["--max-old-space-size=2048"])
    expect(worker._childBackgroundJobsEnvironment().MALLOC_ARENA_MAX).toEqual("4")
  })

  it("honors explicit runner cap overrides", () => {
    const worker = new BackgroundJobsWorker({host: "127.0.0.1", pooledRunnerCount: 1, port: 7331, runnerMaxOldSpaceSizeMb: 4096, runnerMallocArenaMax: 2})

    worker.configuration = /** @type {ReturnType<typeof JSON.parse>} */ ({getEnvironment: () => "test"})

    expect(worker._childRunnerExecArgv()).toEqual(["--max-old-space-size=4096"])
    expect(worker._childBackgroundJobsEnvironment().MALLOC_ARENA_MAX).toEqual("2")
  })
})
