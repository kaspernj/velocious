// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import Dummy from "../dummy/index.js"
import WebsocketClient from "../../src/http-client/websocket-client.js"
import waitFor from "../helpers/wait-for.js"

async function openEchoConnection(client, closeReasons) {
  const connection = client.openConnection("Echo", {
    onClose: (reason) => closeReasons.push(reason)
  })

  await connection.ready

  return connection
}

async function withEchoConnection(callback) {
  await Dummy.run(async () => {
    const client = new WebsocketClient()

    try {
      await client.connect()

      /** @type {string[]} */
      const closeReasons = []
      const connection = await openEchoConnection(client, closeReasons)

      await callback({client, closeReasons, connection})
    } finally {
      await client.close()
    }
  })
}

describe("WebsocketConnection (Phase 1A)", {databaseCleaning: {transaction: true}}, () => {
  it("routes connection-open → onConnect and echoes the welcome message", async () => {
    await Dummy.run(async () => {
      const client = new WebsocketClient()

      try {
        await client.connect()

        /** @type {any[]} */
        const received = []
        const connection = client.openConnection("Echo", {
          params: {name: "velocious"},
          onMessage: (body) => received.push(body)
        })

        await connection.ready

        expect(connection.isConnected()).toBe(true)

        await waitFor(() => received.length > 0)
        expect(received[0]).toEqual({hello: "velocious"})
      } finally {
        await client.close()
      }
    })
  })

  it("round-trips connection-message from client to server and back", async () => {
    await Dummy.run(async () => {
      const client = new WebsocketClient()

      try {
        await client.connect()

        /** @type {any[]} */
        const received = []
        const connection = client.openConnection("Echo", {
          onMessage: (body) => received.push(body)
        })

        await connection.ready
        await waitFor(() => received.length >= 1)
        // Drain the welcome message.
        received.length = 0

        connection.sendMessage({ping: 1})
        await waitFor(() => received.length >= 1)
        expect(received[0]).toEqual({echo: {ping: 1}})

        connection.sendMessage({ping: 2})
        await waitFor(() => received.length >= 2)
        expect(received[1]).toEqual({echo: {ping: 2}})
      } finally {
        await client.close()
      }
    })
  })

  it("fires onClose(client_close) immediately when the client calls close()", async () => {
    await withEchoConnection(async ({closeReasons, connection}) => {
      connection.close()

      expect(connection.isClosed()).toBe(true)
      expect(closeReasons).toEqual(["client_close"])
      // Server-side onClose firing is verified on the server-close
      // path below; for client_close we can't observe it because the
      // client has already dropped the id from its registry by the
      // time the server's reply messages arrive.
    })
  })

  it("fires onClose(server_close) when the server initiates the close", async () => {
    await withEchoConnection(async ({closeReasons, connection}) => {
      // Ask the server-side EchoConnection to close itself.
      connection.sendMessage({__testCloseFromServer: true})

      await waitFor(() => connection.isClosed())
      expect(closeReasons).toEqual(["server_close"])
    })
  })

  it("fires onClose(session_destroyed) on every live connection when the socket drops", async () => {
    await Dummy.run(async () => {
      const client = new WebsocketClient()

      await client.connect()

      /** @type {string[]} */
      const clientCloseReasons = []
      const connection = client.openConnection("Echo", {
        onClose: (reason) => clientCloseReasons.push(reason)
      })

      await connection.ready
      await client.close()

      await waitFor(() => connection.isClosed())
      expect(clientCloseReasons).toEqual(["session_destroyed"])
    })
  })

  it("sends connection-error when opening an unknown connection type", async () => {
    await Dummy.run(async () => {
      const client = new WebsocketClient()

      try {
        await client.connect()

        /** @type {string[]} */
        const closeReasons = []
        const connection = client.openConnection("Nonexistent", {
          onClose: (reason) => closeReasons.push(reason)
        })

        let rejected = false

        await connection.ready.catch(() => { rejected = true })

        expect(rejected).toBe(true)
        expect(closeReasons.length).toBe(1)
        expect(closeReasons[0].startsWith("error:")).toBe(true)
      } finally {
        await client.close()
      }
    })
  })
})
