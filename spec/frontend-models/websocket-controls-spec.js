// @ts-check

import wait from "awaitery/build/wait.js"

import {describe, expect, it} from "../../src/testing/test.js"
import FrontendModelBase from "../../src/frontend-models/base.js"
import VelociousWebsocketClient from "../../src/http-client/websocket-client.js"
import {bufferedOutgoingEventCount, bufferOutgoingEvent, clearBufferedOutgoingEvents} from "../../src/frontend-models/outgoing-event-buffer.js"
import {resetFrontendModelTransport} from "../helpers/frontend-model-test-helpers.js"

/**
 * Builds a controllable snapreq-compatible client.
 * @param {{connectDelayMs?: number, readyDelayMs?: number, initiallyOpen?: boolean}} [args] - Delay and state controls.
 * @returns {{calls: Array<{options: Record<string, ?>, stage: string}>, client: Record<string, ?>, state: {closed: number, open: boolean, opened: number}}} - Client fixture.
 */
function buildControlledClient({connectDelayMs = 0, readyDelayMs = 0, initiallyOpen = false} = {}) {
  /** @type {Array<{options: Record<string, ?>, stage: string}>} */
  const calls = []
  const state = {closed: 0, open: initiallyOpen, opened: 0}
  const createHandle = (options) => {
    let closed = false
    const handle = {
      close: () => {
        if (closed) return

        closed = true
        state.closed += 1
      },
      customHandleMethod: () => "preserved",
      isClosed: () => closed,
      ready: wait(readyDelayMs, {signal: options.signal}).then(() => {
        if (!closed) state.opened += 1
      }),
      sendMessage: () => {}
    }

    return handle
  }
  const client = {
    connect: async (options = {}) => {
      calls.push({options, stage: "connect"})
      await wait(connectDelayMs, {signal: options.signal})
      state.open = true
    },
    isOpen: () => state.open,
    openConnection: (_connectionType, options = {}) => {
      if (!state.open) throw new Error("Websocket is not open; call connect() first")

      calls.push({options, stage: "open"})

      return createHandle(options)
    },
    subscribeChannel: (_channelType, options = {}) => {
      calls.push({options, stage: "subscribe"})

      return createHandle(options)
    }
  }

  return {calls, client, state}
}

class ControlledWebSocket {
  static autoOpen = true
  static deferNextClose = false
  static deferSessionResume = false
  /** @type {ControlledWebSocket[]} */
  static instances = []
  /** @type {(socket: ControlledWebSocket) => void} */
  static onCreate = () => {}
  /** @type {(message: Record<string, ?>) => void} */
  static onRequest = () => {}
  /** @type {() => void} */
  static onSessionResumePending = () => {}
  /** @type {(() => void) | null} */
  static pendingClose = null
  /** @type {(() => void) | null} */
  static pendingSessionResume = null
  /** @type {Array<Record<string, ?>>} */
  static sentMessages = []
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  constructor() {
    this.CONNECTING = ControlledWebSocket.CONNECTING
    this.OPEN = ControlledWebSocket.OPEN
    this.CLOSING = ControlledWebSocket.CLOSING
    this.CLOSED = ControlledWebSocket.CLOSED
    this.readyState = this.CONNECTING
    /** @type {Map<string, Set<(event: Event | MessageEvent) => void>>} */
    this.listeners = new Map()
    ControlledWebSocket.instances.push(this)
    ControlledWebSocket.onCreate(this)

    if (ControlledWebSocket.autoOpen) {
      queueMicrotask(() => {
        this.readyState = this.OPEN
        this.dispatch("open", new Event("open"))
        this.dispatch("message", new MessageEvent("message", {
          data: JSON.stringify({sessionId: "session-1", type: "session-established"})
        }))
      })
    }
  }

  /** @param {string} type - Event type. @param {(event: Event | MessageEvent) => void} callback - Listener. @returns {void} */
  addEventListener(type, callback) {
    const callbacks = this.listeners.get(type) || new Set()

    callbacks.add(callback)
    this.listeners.set(type, callbacks)
  }

  /** @param {string} type - Event type. @param {(event: Event | MessageEvent) => void} callback - Listener. @returns {void} */
  removeEventListener(type, callback) {
    this.listeners.get(type)?.delete(callback)
  }

  /** @param {string} type - Event type. @param {Event | MessageEvent} event - Event. @returns {void} */
  dispatch(type, event) {
    for (const callback of this.listeners.get(type) || []) callback(event)
  }

  /** @returns {void} */
  close() {
    if (this.readyState === this.CLOSED) return

    const finishClose = () => {
      this.readyState = this.CLOSED
      this.dispatch("close", new Event("close"))
    }

    if (ControlledWebSocket.deferNextClose) {
      ControlledWebSocket.deferNextClose = false
      this.readyState = this.CLOSING
      ControlledWebSocket.pendingClose = finishClose
      return
    }

    finishClose()
  }

  /** @param {string} payload - Serialized websocket payload. @returns {void} */
  send(payload) {
    const message = JSON.parse(payload)

    ControlledWebSocket.sentMessages.push(message)

    if (message.type === "session-resume") {
      const finishSessionResume = () => {
        this.dispatch("message", new MessageEvent("message", {
          data: JSON.stringify({sessionId: message.sessionId, type: "session-resumed"})
        }))
      }

      if (ControlledWebSocket.deferSessionResume) {
        ControlledWebSocket.pendingSessionResume = finishSessionResume
        ControlledWebSocket.onSessionResumePending()
      } else {
        queueMicrotask(finishSessionResume)
      }
    } else if (message.type === "request") {
      ControlledWebSocket.onRequest(message)
      queueMicrotask(() => {
        this.dispatch("message", new MessageEvent("message", {
          data: JSON.stringify({body: {ok: true}, id: message.id, status: 200, type: "response"})
        }))
      })
    }
  }

  /** @returns {void} */
  static finishPendingClose() {
    const finishClose = ControlledWebSocket.pendingClose

    ControlledWebSocket.pendingClose = null
    finishClose?.()
  }

  /** @returns {void} */
  static finishPendingSessionResume() {
    const finishSessionResume = ControlledWebSocket.pendingSessionResume

    ControlledWebSocket.pendingSessionResume = null
    finishSessionResume?.()
  }
}

describe("frontend-models - WebSocket controls", () => {
  it("composes configured controls into direct connect and preserves the session abort reason", async () => {
    const OriginalWebSocket = globalThis.WebSocket
    const controller = new AbortController()
    const reason = new Error("session ended")

    ControlledWebSocket.autoOpen = false
    ControlledWebSocket.instances = []
    globalThis.WebSocket = /** @type {typeof WebSocket} */ (ControlledWebSocket)
    FrontendModelBase.configureTransport({signal: controller.signal, timeout: 500, websocketUrl: "ws://example.test/websocket"})

    try {
      const connecting = FrontendModelBase.connectWebsocket({timeoutMs: 1_000})

      controller.abort(reason)
      await expect(async () => await connecting).toThrow(reason)
      expect(ControlledWebSocket.instances[0].readyState).toEqual(ControlledWebSocket.CLOSED)
    } finally {
      await FrontendModelBase.disconnectWebsocket()
      globalThis.WebSocket = OriginalWebSocket
      resetFrontendModelTransport()
    }
  })

  it("keeps an identical configured signal client and rebinds cancellation after disconnect", async () => {
    const OriginalWebSocket = globalThis.WebSocket
    const controller = new AbortController()

    ControlledWebSocket.autoOpen = true
    ControlledWebSocket.instances = []
    globalThis.WebSocket = /** @type {typeof WebSocket} */ (ControlledWebSocket)
    FrontendModelBase.configureTransport({signal: controller.signal, websocketUrl: "ws://example.test/websocket"})

    try {
      await FrontendModelBase.connectWebsocket()
      FrontendModelBase.configureTransport({signal: controller.signal})
      await FrontendModelBase.connectWebsocket()
      expect(ControlledWebSocket.instances.length).toEqual(1)

      await FrontendModelBase.disconnectWebsocket()
      await FrontendModelBase.connectWebsocket()
      expect(ControlledWebSocket.instances.length).toEqual(2)

      controller.abort(new Error("signed out"))
      await wait(0)
      expect(ControlledWebSocket.instances[1].readyState).toEqual(ControlledWebSocket.CLOSED)
    } finally {
      await FrontendModelBase.disconnectWebsocket()
      globalThis.WebSocket = OriginalWebSocket
      resetFrontendModelTransport()
    }
  })

  it("rebinds a cached client when a signal provider returns a new session signal", async () => {
    const OriginalWebSocket = globalThis.WebSocket
    const sessionAController = new AbortController()
    const sessionBController = new AbortController()
    let sessionController = sessionAController

    ControlledWebSocket.autoOpen = true
    ControlledWebSocket.instances = []
    globalThis.WebSocket = /** @type {typeof WebSocket} */ (ControlledWebSocket)
    FrontendModelBase.configureTransport({
      signal: () => sessionController.signal,
      websocketUrl: "ws://example.test/websocket"
    })

    try {
      await FrontendModelBase.connectWebsocket()
      sessionAController.abort(new Error("session A ended"))
      await wait(0)
      expect(ControlledWebSocket.instances[0].readyState).toEqual(ControlledWebSocket.CLOSED)

      sessionController = sessionBController
      await FrontendModelBase.connectWebsocket()
      expect(ControlledWebSocket.instances.length).toEqual(2)

      sessionBController.abort(new Error("session B ended"))
      await wait(0)
      expect(ControlledWebSocket.instances[1].readyState).toEqual(ControlledWebSocket.CLOSED)
    } finally {
      await FrontendModelBase.disconnectWebsocket()
      globalThis.WebSocket = OriginalWebSocket
      resetFrontendModelTransport()
    }
  })

  it("isolates an overlapping replacement session and preserves its automatic reconnect", async () => {
    const OriginalWebSocket = globalThis.WebSocket
    const originalSetTimeout = globalThis.setTimeout
    const originalClearTimeout = globalThis.clearTimeout
    const sessionAController = new AbortController()
    const sessionBController = new AbortController()
    let sessionController = sessionAController
    /** @type {(() => void) | null} */
    let reconnect = null
    /** @type {() => void} */
    let resolveReconnectScheduled = () => {}
    const reconnectScheduled = new Promise((resolve) => { resolveReconnectScheduled = resolve })

    ControlledWebSocket.autoOpen = true
    ControlledWebSocket.deferNextClose = false
    ControlledWebSocket.instances = []
    ControlledWebSocket.onCreate = () => {}
    ControlledWebSocket.pendingClose = null
    globalThis.WebSocket = /** @type {typeof WebSocket} */ (ControlledWebSocket)
    FrontendModelBase.configureTransport({
      signal: () => sessionController.signal,
      websocketUrl: "ws://example.test/websocket"
    })

    try {
      await FrontendModelBase.connectWebsocket()
      ControlledWebSocket.deferNextClose = true
      sessionAController.abort(new Error("session A ended"))
      expect(ControlledWebSocket.instances[0].readyState).toEqual(ControlledWebSocket.CLOSING)
      expect(FrontendModelBase.websocketState().hasClient).toBe(false)

      sessionController = sessionBController
      const replacementCreated = new Promise((resolve) => {
        ControlledWebSocket.onCreate = () => resolve(undefined)
      })
      const replacementConnect = FrontendModelBase.connectWebsocket()

      void replacementConnect.catch(() => {})
      await replacementCreated
      await replacementConnect
      expect(ControlledWebSocket.instances.length).toEqual(2)
      expect(ControlledWebSocket.instances[1].readyState).toEqual(ControlledWebSocket.OPEN)

      ControlledWebSocket.finishPendingClose()
      await Promise.resolve()
      expect(ControlledWebSocket.instances[1].readyState).toEqual(ControlledWebSocket.OPEN)
      expect(FrontendModelBase.websocketState().isOpen).toBe(true)

      globalThis.setTimeout = (callback) => {
        reconnect = () => callback()
        resolveReconnectScheduled()

        return /** @type {ReturnType<typeof setTimeout>} */ ({})
      }
      globalThis.clearTimeout = () => {}
      const reconnectedSocketCreated = new Promise((resolve) => {
        ControlledWebSocket.onCreate = () => resolve(undefined)
      })

      await FrontendModelBase.dropWebsocket()
      await reconnectScheduled
      reconnect?.()
      await reconnectedSocketCreated
      await FrontendModelBase.connectWebsocket()

      expect(ControlledWebSocket.instances.length).toEqual(3)
      expect(ControlledWebSocket.instances[2].readyState).toEqual(ControlledWebSocket.OPEN)

      sessionBController.abort(new Error("session B ended"))
      expect(FrontendModelBase.websocketState().hasClient).toBe(false)
      await Promise.resolve()
      expect(ControlledWebSocket.instances[2].readyState).toEqual(ControlledWebSocket.CLOSED)
    } finally {
      ControlledWebSocket.finishPendingClose()
      ControlledWebSocket.deferNextClose = false
      sessionBController.abort(new Error("test cleanup"))
      await FrontendModelBase.disconnectWebsocket()
      ControlledWebSocket.onCreate = () => {}
      globalThis.setTimeout = originalSetTimeout
      globalThis.clearTimeout = originalClearTimeout
      globalThis.WebSocket = OriginalWebSocket
      resetFrontendModelTransport()
    }
  })

  it("keeps a stale session reconnect from flushing the replacement session buffer", async () => {
    const OriginalWebSocket = globalThis.WebSocket
    const originalSetTimeout = globalThis.setTimeout
    const originalClearTimeout = globalThis.clearTimeout
    const sessionAController = new AbortController()
    const sessionBController = new AbortController()
    let sessionController = sessionAController
    /** @type {Array<() => void>} */
    const reconnectCallbacks = []
    /** @type {() => void} */
    let resolveReconnectScheduled = () => {}
    let reconnectScheduled = new Promise((resolve) => { resolveReconnectScheduled = resolve })

    ControlledWebSocket.autoOpen = true
    ControlledWebSocket.deferNextClose = false
    ControlledWebSocket.deferSessionResume = false
    ControlledWebSocket.instances = []
    ControlledWebSocket.onCreate = () => {}
    ControlledWebSocket.onRequest = () => {}
    ControlledWebSocket.onSessionResumePending = () => {}
    ControlledWebSocket.pendingClose = null
    ControlledWebSocket.pendingSessionResume = null
    ControlledWebSocket.sentMessages = []
    clearBufferedOutgoingEvents()
    globalThis.WebSocket = /** @type {typeof WebSocket} */ (ControlledWebSocket)
    globalThis.setTimeout = (callback) => {
      reconnectCallbacks.push(() => callback())
      resolveReconnectScheduled()

      return /** @type {ReturnType<typeof setTimeout>} */ ({})
    }
    globalThis.clearTimeout = () => {}
    FrontendModelBase.configureTransport({
      signal: () => sessionController.signal,
      websocketUrl: "ws://example.test/websocket"
    })

    try {
      await FrontendModelBase.connectWebsocket()
      await FrontendModelBase.dropWebsocket()
      await reconnectScheduled

      ControlledWebSocket.deferSessionResume = true
      const sessionAResumePending = new Promise((resolve) => {
        ControlledWebSocket.onSessionResumePending = () => resolve(undefined)
      })
      const sessionAReconnectCreated = new Promise((resolve) => {
        ControlledWebSocket.onCreate = () => resolve(undefined)
      })
      expect(reconnectCallbacks.length).toEqual(1)
      reconnectCallbacks.shift()?.()
      await sessionAReconnectCreated
      await sessionAResumePending

      ControlledWebSocket.finishPendingSessionResume()
      sessionAController.abort(new Error("session A ended"))
      sessionController = sessionBController
      const sessionBConnect = FrontendModelBase.connectWebsocket()

      bufferOutgoingEvent({customPath: "/owned-by-b", payload: {owner: "b"}})
      await sessionBConnect
      expect(bufferedOutgoingEventCount()).toEqual(1)
      expect(ControlledWebSocket.sentMessages.filter((message) => message.path === "/owned-by-b").length).toEqual(0)

      reconnectScheduled = new Promise((resolve) => { resolveReconnectScheduled = resolve })
      ControlledWebSocket.deferSessionResume = false
      await FrontendModelBase.dropWebsocket()
      await reconnectScheduled
      const sessionBReconnectCreated = new Promise((resolve) => {
        ControlledWebSocket.onCreate = () => resolve(undefined)
      })
      /** @type {() => void} */
      let resolveSessionBRequest = () => {}
      const sessionBRequest = new Promise((resolve) => { resolveSessionBRequest = resolve })
      ControlledWebSocket.onRequest = (message) => {
        if (message.path === "/owned-by-b") resolveSessionBRequest()
      }
      expect(reconnectCallbacks.length).toEqual(1)
      reconnectCallbacks.shift()?.()

      await sessionBReconnectCreated
      await sessionBRequest
      expect(bufferedOutgoingEventCount()).toEqual(0)
      expect(ControlledWebSocket.sentMessages.filter((message) => message.path === "/owned-by-b").length).toEqual(1)
    } finally {
      ControlledWebSocket.finishPendingSessionResume()
      ControlledWebSocket.finishPendingClose()
      ControlledWebSocket.deferNextClose = false
      ControlledWebSocket.deferSessionResume = false
      sessionBController.abort(new Error("test cleanup"))
      await FrontendModelBase.disconnectWebsocket()
      clearBufferedOutgoingEvents()
      ControlledWebSocket.onCreate = () => {}
      ControlledWebSocket.onRequest = () => {}
      ControlledWebSocket.onSessionResumePending = () => {}
      globalThis.setTimeout = originalSetTimeout
      globalThis.clearTimeout = originalClearTimeout
      globalThis.WebSocket = OriginalWebSocket
      resetFrontendModelTransport()
    }
  })

  it("drains an automatic reconnect already checking online when the session aborts", async () => {
    const OriginalWebSocket = globalThis.WebSocket
    const controller = new AbortController()
    /** @type {(isOnline: boolean) => void} */
    let notifyNetworkChange = () => {}
    /** @type {() => void} */
    let releaseOnlineCheck = () => {}
    /** @type {() => void} */
    let resolveOnlineCheckStarted = () => {}
    let isOnline = true
    let deferOnlineCheck = false
    const onlineCheckStarted = new Promise((resolve) => { resolveOnlineCheckStarted = resolve })

    ControlledWebSocket.autoOpen = true
    ControlledWebSocket.instances = []
    globalThis.WebSocket = /** @type {typeof WebSocket} */ (ControlledWebSocket)

    const client = new VelociousWebsocketClient({
      autoReconnect: true,
      networkMonitor: {
        getIsOnline: () => {
          if (!deferOnlineCheck) return isOnline

          resolveOnlineCheckStarted()

          return new Promise((resolve) => {
            releaseOnlineCheck = () => resolve(true)
          })
        },
        subscribe: (callback) => {
          notifyNetworkChange = callback

          return () => { notifyNetworkChange = () => {} }
        }
      },
      reconnectDelays: [0],
      url: "ws://example.test/websocket"
    })
    /** @type {Promise<void>} */
    let teardown = Promise.resolve()
    controller.signal.addEventListener("abort", () => {
      teardown = client.disconnectAndStopReconnect()
    }, {once: true})

    try {
      await client.connect()
      isOnline = false
      notifyNetworkChange(false)
      await Promise.resolve()
      deferOnlineCheck = true
      notifyNetworkChange(true)
      await onlineCheckStarted

      controller.abort(new Error("session ended"))
      releaseOnlineCheck()
      await teardown

      expect(ControlledWebSocket.instances.length).toEqual(1)
      expect(ControlledWebSocket.instances[0].readyState).toEqual(ControlledWebSocket.CLOSED)
      expect(client.isOpen()).toBe(false)
      expect(client.autoReconnect).toBe(false)
      expect(client.reconnectTimer).toEqual(null)
      expect(client.runningReconnectTasks.size).toEqual(0)
      expect(client._waitingForOnline).toBe(false)
    } finally {
      releaseOnlineCheck()
      await client.disconnectAndStopReconnect()
      globalThis.WebSocket = OriginalWebSocket
      resetFrontendModelTransport()
    }
  })

  it("returns the real synchronous channel handle and preserves the caller abort reason", async () => {
    const fixture = buildControlledClient({connectDelayMs: 100})
    const controller = new AbortController()
    const reason = new Error("session ended")

    FrontendModelBase.configureTransport({websocketClient: fixture.client})

    try {
      const handle = FrontendModelBase.subscribeWebsocketChannel("tasks", {signal: controller.signal, timeoutMs: 500})

      expect(handle.customHandleMethod()).toEqual("preserved")
      controller.abort(reason)
      await expect(async () => await handle.ready).toThrow(reason)
      expect(fixture.state.closed).toEqual(1)
    } finally {
      resetFrontendModelTransport()
    }
  })

  it("starts queued channel connect and readiness with the same bounded budget", async () => {
    const fixture = buildControlledClient({connectDelayMs: 20, readyDelayMs: 20})

    FrontendModelBase.configureTransport({timeout: 80, websocketClient: fixture.client})

    try {
      const handle = FrontendModelBase.subscribeWebsocketChannel("tasks", {timeoutMs: 500})

      await handle.ready
      expect(fixture.calls.map((call) => call.stage)).toEqual(["subscribe", "connect"])
      expect(fixture.calls[0].options.timeoutMs).toEqual(80)
      expect(fixture.calls[1].options.timeoutMs).toEqual(80)
    } finally {
      resetFrontendModelTransport()
    }
  })

  it("returns the real synchronous one-to-one handle after explicit connection", async () => {
    const fixture = buildControlledClient()

    FrontendModelBase.configureTransport({websocketClient: fixture.client})

    try {
      await fixture.client.connect()
      const handle = FrontendModelBase.openWebsocketConnection("presence", {
        params: {locale: "da"},
        timeoutMs: 100
      })

      expect(handle.customHandleMethod()).toEqual("preserved")
      expect(fixture.calls.map((call) => call.stage)).toEqual(["connect", "open"])
      expect(fixture.calls[1].options.params).toEqual({locale: "da"})
      await handle.ready
      handle.close()
    } finally {
      resetFrontendModelTransport()
    }
  })

  it("keeps startup controls out of channel params", async () => {
    const fixture = buildControlledClient()
    const controller = new AbortController()

    FrontendModelBase.configureTransport({websocketClient: fixture.client})

    try {
      const handle = FrontendModelBase.subscribeWebsocketChannel("tasks", {
        params: {projectId: 7},
        signal: controller.signal,
        timeoutMs: 50
      })
      const subscribeOptions = fixture.calls[0].options

      expect(subscribeOptions.params).toEqual({projectId: 7})
      expect(subscribeOptions.params.signal).toEqual(undefined)
      expect(subscribeOptions.params.timeoutMs).toEqual(undefined)
      await handle.ready
    } finally {
      resetFrontendModelTransport()
    }
  })

  it("stops a managed retry timer on session abort without a late open", () => {
    const fixture = buildControlledClient()
    const controller = new AbortController()
    const originalSetTimeout = globalThis.setTimeout
    const originalClearTimeout = globalThis.clearTimeout
    /** @type {Array<() => void>} */
    const callbacks = []
    let cleared = 0

    globalThis.setTimeout = (callback) => {
      callbacks.push(callback)

      return /** @type {ReturnType<typeof setTimeout>} */ ({})
    }
    globalThis.clearTimeout = () => {
      cleared += 1
    }
    FrontendModelBase.configureTransport({signal: controller.signal, websocketClient: fixture.client})

    try {
      const handle = FrontendModelBase.openManagedConnection("presence", {
        params: () => ({locale: "da"}),
        shouldConnect: () => true
      })

      expect(callbacks.length).toEqual(1)
      controller.abort(new Error("signed out"))
      callbacks[0]()
      fixture.state.open = true
      handle.sync()

      expect(cleared).toEqual(1)
      expect(fixture.calls.filter((call) => call.stage === "open").length).toEqual(0)
      expect(fixture.state.closed).toEqual(0)
    } finally {
      globalThis.setTimeout = originalSetTimeout
      globalThis.clearTimeout = originalClearTimeout
      resetFrontendModelTransport()
    }
  })

  it("closes a managed handle exactly once when the session aborts", async () => {
    const fixture = buildControlledClient({initiallyOpen: true, readyDelayMs: 20})
    const controller = new AbortController()

    FrontendModelBase.configureTransport({signal: controller.signal, websocketClient: fixture.client})

    try {
      const handle = FrontendModelBase.openManagedConnection("presence", {
        params: () => ({locale: "da"}),
        shouldConnect: () => true
      })

      controller.abort(new Error("signed out"))
      handle.close()
      await wait(30)

      expect(fixture.state.closed).toEqual(1)
      expect(fixture.state.opened).toEqual(0)
    } finally {
      resetFrontendModelTransport()
    }
  })
})
