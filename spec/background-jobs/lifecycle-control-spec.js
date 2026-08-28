// @ts-check

import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import timeout, { TimeoutError } from "awaitery/build/timeout.js"
import BackgroundJobsLifecycleClient from "../../src/background-jobs/lifecycle-client.js"
import dummyConfiguration from "../dummy/src/config/configuration.js"
import { connectGenerationPeer, startGenerationMain } from "../helpers/background-jobs-generation-harness.js"
import releaseLifecyclePaths from "../helpers/release-lifecycle-paths.js"
import stalledSocketServer from "../helpers/stalled-socket-server.js"
import { describe, expect, it } from "../../src/testing/test.js"

describe("Background jobs lifecycle control", () => {
  it("times out one stalled lifecycle request and destroys its Unix socket connection", async () => {
    const paths = await releaseLifecyclePaths()
    const stalled = await stalledSocketServer({socketPath: paths.socketPath})
    const client = new BackgroundJobsLifecycleClient({
      configuration: dummyConfiguration,
      generationId: "release-stalled-control",
      requestTimeoutMs: 25,
      socketPath: paths.socketPath
    })

    try {
      let requestError
      try {
        await timeout({errorMessage: "Test guard expired before lifecycle timeout", timeout: 250}, async () => await client.retire())
      } catch (error) {
        requestError = error
      }
      if (!(requestError instanceof Error)) throw new Error("Expected lifecycle timeout error")

      expect(requestError instanceof TimeoutError).toEqual(true)
      expect(requestError.message).toMatch(/retire.*release-stalled-control.*25ms/)
      expect(requestError.message).toMatch(new RegExp(paths.socketPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
      await stalled.requestReceived
      await timeout({errorMessage: "Timed-out lifecycle socket stayed open", timeout: 250}, async () => await stalled.connectionClosed)
      expect(stalled.requestCount()).toEqual(1)
    } finally {
      await stalled.close()
      await fs.rm(paths.directory, {recursive: true})
    }
  })

  it("acknowledges activation and retirement fences over a mode-0600 Unix socket", async () => {
    const paths = await releaseLifecyclePaths()
    const {main} = await startGenerationMain({
      generationId: "release-control",
      initialGenerationState: "candidate",
      lifecycleSocketPath: paths.socketPath
    })
    const peer = await connectGenerationPeer(main.getPort())
    const client = new BackgroundJobsLifecycleClient({
      configuration: dummyConfiguration,
      generationId: "release-control",
      socketPath: paths.socketPath
    })

    try {
      expect((await fs.stat(paths.socketPath)).mode & 0o777).toEqual(0o600)
      expect(await client.activate()).toEqual("active")

      const accepted = peer.nextMessage()
      peer.jsonSocket.send({
        type: "hello",
        role: "worker",
        generationId: "release-control",
        workerId: "release-control:67e6ac23-bd14-4768-abe3-4256fe953dd9",
        supportsHandoffIdReporting: true,
        supportsHeartbeat: true
      })
      await accepted
      const retireMessage = peer.nextMessage()

      expect(await client.retire()).toEqual("retired")
      expect(await client.retire()).toEqual("retired")
      expect(main.getLifecycleState()).toEqual("retired")
      expect((await retireMessage).type).toEqual("retire")
      expect(main.server?.listening).toEqual(true)

      await peer.close()
      await main.waitUntilStopped()
      await expect(async () => await fs.lstat(paths.socketPath)).toThrow(/ENOENT/)
    } finally {
      await peer.close()
      await main.stop()
      await fs.rm(paths.directory, {recursive: true})
    }
  })

  it("preserves server errors and emits lifecycle failures on framework channels", async () => {
    const paths = await releaseLifecyclePaths()
    const {main} = await startGenerationMain({
      generationId: "release-errors",
      initialGenerationState: "candidate",
      lifecycleSocketPath: paths.socketPath
    })
    /** @type {Array<ReturnType<typeof JSON.parse>>} */
    const failures = []
    const errorEvents = dummyConfiguration.getErrorEvents()
    const onFrameworkError = (/** @type {ReturnType<typeof JSON.parse>} */ payload) => failures.push(payload)
    errorEvents.on("framework-error", onFrameworkError)
    const client = new BackgroundJobsLifecycleClient({
      configuration: dummyConfiguration,
      generationId: "another-release",
      socketPath: paths.socketPath
    })

    try {
      const error = await (async () => {
        try {
          await client.activate()
        } catch (caught) {
          if (caught instanceof Error) return caught
          throw caught
        }
        throw new Error("Expected lifecycle request to fail")
      })()

      expect(error.message).toMatch(/generation mismatch/)
      expect(error.stack).toMatch(/lifecycle generation mismatch/)
      expect(failures.length).toEqual(1)
      expect(failures[0].context.stage).toEqual("background-jobs-lifecycle-control")
    } finally {
      await main.stop()
      errorEvents.off("framework-error", onFrameworkError)
      await fs.rm(paths.directory, {recursive: true})
    }
  })

  it("refuses non-socket and symlink collisions without removing them", async () => {
    for (const collisionType of ["file", "symlink"]) {
      const paths = await releaseLifecyclePaths()
      const target = path.join(paths.directory, "target")
      await fs.writeFile(target, "owned test target")
      if (collisionType === "file") await fs.writeFile(paths.socketPath, "collision")
      else await fs.symlink(target, paths.socketPath)

      try {
        await expect(async () => await startGenerationMain({
          generationId: "release-collision",
          initialGenerationState: "candidate",
          lifecycleSocketPath: paths.socketPath
        })).toThrow(/collision/)
        expect((await fs.lstat(paths.socketPath)).isSymbolicLink()).toEqual(collisionType === "symlink")
      } finally {
        await fs.rm(paths.directory, {recursive: true})
      }
    }
  })

  it("refuses an active socket collision and preserves an inode replacement during cleanup", async () => {
    const activePaths = await releaseLifecyclePaths()
    const {main: activeMain} = await startGenerationMain({
      generationId: "release-active-collision",
      initialGenerationState: "candidate",
      lifecycleSocketPath: activePaths.socketPath
    })

    try {
      await expect(async () => await startGenerationMain({
        generationId: "release-second-collision",
        initialGenerationState: "candidate",
        lifecycleSocketPath: activePaths.socketPath
      })).toThrow(/already active/)
      expect((await fs.lstat(activePaths.socketPath)).isSocket()).toEqual(true)
    } finally {
      await activeMain.stop()
      await fs.rm(activePaths.directory, {recursive: true})
    }

    const replacementPaths = await releaseLifecyclePaths()
    const {main: replacementMain} = await startGenerationMain({
      generationId: "release-inode-replacement",
      initialGenerationState: "candidate",
      lifecycleSocketPath: replacementPaths.socketPath
    })
    await fs.unlink(replacementPaths.socketPath)
    await fs.writeFile(replacementPaths.socketPath, "replacement")

    try {
      await replacementMain.stop()
      expect(await fs.readFile(replacementPaths.socketPath, "utf8")).toEqual("replacement")
    } finally {
      await replacementMain.stop()
      await fs.rm(replacementPaths.directory, {recursive: true})
    }
  })

  it("rejects a lifecycle socket outside the configured release directory", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "velocious-generation-outside-release-"))

    try {
      await expect(async () => await startGenerationMain({
        generationId: "release-outside",
        initialGenerationState: "candidate",
        lifecycleSocketPath: path.join(directory, "main.sock")
      })).toThrow(/inside the release directory/)
      await expect(async () => await fs.lstat(path.join(directory, "main.sock"))).toThrow(/ENOENT/)
    } finally {
      await fs.rm(directory, {recursive: true})
    }
  })
})
