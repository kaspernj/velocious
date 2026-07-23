// @ts-check

import timeout, {TimeoutError} from "awaitery/build/timeout.js"
import wait from "awaitery/build/wait.js"

import {describe, expect, it} from "../../src/testing/test.js"
import FrontendModelBase from "../../src/frontend-models/base.js"
import {resetFrontendModelTransport} from "../helpers/frontend-model-test-helpers.js"

/**
 * Runs a controllable snapreq-compatible startup stage.
 * @param {number} delayMs - Delay before readiness.
 * @param {{timeoutMs?: number, signal?: AbortSignal}} controls - Operation controls.
 * @returns {Promise<void>} - Resolves after the delay.
 */
async function controlledDelay(delayMs, controls) {
  if (controls.timeoutMs !== undefined) {
    await timeout({timeout: controls.timeoutMs, signal: controls.signal}, async ({control}) => {
      await wait(delayMs, {signal: control.signal})
    })
    return
  }

  await wait(delayMs, {signal: controls.signal})
}

/**
 * Builds a snapreq-compatible client with deterministic connect/readiness delays.
 * @param {{connectDelayMs?: number, readyDelayMs?: number}} [args] - Delay controls.
 * @returns {{calls: Array<{options: Record<string, ?>, stage: string}>, client: Record<string, ?>, state: {closed: number}}} - Client fixture.
 */
function buildControlledClient({connectDelayMs = 0, readyDelayMs = 0} = {}) {
  /** @type {Array<{options: Record<string, ?>, stage: string}>} */
  const calls = []
  const state = {closed: 0}
  const client = {
    connect: async (options = {}) => {
      calls.push({options, stage: "connect"})
      await controlledDelay(connectDelayMs, options)
    },
    openConnection: (_connectionType, options = {}) => {
      calls.push({options, stage: "open"})

      return {
        close: () => {
          state.closed += 1
        },
        ready: controlledDelay(readyDelayMs, options)
      }
    },
    subscribeChannel: (_channelType, options = {}) => {
      calls.push({options, stage: "subscribe"})

      return {
        close: () => {
          state.closed += 1
        },
        ready: controlledDelay(readyDelayMs, options)
      }
    }
  }

  return {calls, client, state}
}

describe("frontend-models - WebSocket controls", () => {
  it("bounds delayed connect startup and preserves caller abort reasons", async () => {
    const fixture = buildControlledClient({connectDelayMs: 100})
    const controller = new AbortController()
    const reason = new Error("session ended")

    FrontendModelBase.configureTransport({websocketClient: fixture.client})
    const startup = FrontendModelBase.subscribeWebsocketChannel("tasks", {signal: controller.signal, timeoutMs: 500})
    controller.abort(reason)

    try {
      await expect(async () => await startup).toThrow(reason)
      expect(fixture.state.closed).toEqual(0)
    } finally {
      resetFrontendModelTransport()
    }
  })

  it("uses one total budget across connect and channel readiness", async () => {
    const fixture = buildControlledClient({connectDelayMs: 35, readyDelayMs: 35})

    FrontendModelBase.configureTransport({websocketClient: fixture.client})

    try {
      await expect(async () => {
        await FrontendModelBase.subscribeWebsocketChannel("tasks", {timeoutMs: 55})
      }).toThrow(TimeoutError)
      expect(fixture.calls[1].options.timeoutMs).toBeLessThan(55)
      expect(fixture.state.closed).toEqual(1)
    } finally {
      resetFrontendModelTransport()
    }
  })

  it("applies the same bounded startup contract to one-to-one connections", async () => {
    const fixture = buildControlledClient({connectDelayMs: 20, readyDelayMs: 20})

    FrontendModelBase.configureTransport({websocketClient: fixture.client})

    try {
      const handle = await FrontendModelBase.openWebsocketConnection("presence", {
        params: {locale: "da"},
        timeoutMs: 100
      })

      expect(fixture.calls.map((call) => call.stage)).toEqual(["connect", "open"])
      expect(fixture.calls[1].options.timeoutMs).toBeLessThan(100)
      expect(fixture.calls[1].options.params).toEqual({locale: "da"})
      handle.close()
    } finally {
      resetFrontendModelTransport()
    }
  })

  it("keeps controls out of channel params and removes the startup deadline after readiness", async () => {
    const fixture = buildControlledClient()
    const controller = new AbortController()

    FrontendModelBase.configureTransport({websocketClient: fixture.client})

    try {
      const handle = await FrontendModelBase.subscribeWebsocketChannel("tasks", {
        params: {projectId: 7},
        signal: controller.signal,
        timeoutMs: 50
      })
      const subscribeOptions = fixture.calls[1].options

      expect(subscribeOptions.params).toEqual({projectId: 7})
      expect(subscribeOptions.params.signal).toEqual(undefined)
      expect(subscribeOptions.params.timeoutMs).toEqual(undefined)

      await wait(60)

      expect(fixture.state.closed).toEqual(0)
      handle.close()
      expect(fixture.state.closed).toEqual(1)
    } finally {
      resetFrontendModelTransport()
    }
  })
})
