// @ts-check

import net from "net"
import {listenOnLocalhost} from "./local-server-helper.js"

/**
 * @typedef {object} FakeSmtpServer
 * @property {string[]} commands - Commands received by the server.
 * @property {() => Promise<void>} close - Closes the server.
 * @property {string[]} messages - DATA payloads accepted by the server.
 * @property {string[]} providerVisibleMessages - Messages retained after optional provider idempotency suppression.
 * @property {number} port - Listening port.
 * @property {Promise<void>} quitReceived - Resolves when the server receives QUIT.
 * @property {() => void} releaseQuitResponse - Allows a held QUIT response to continue.
 */

/**
 * Starts a local SMTP protocol fake. It never opens an external connection.
 * @param {object} [args] - Server options.
 * @param {boolean} [args.holdQuitResponse] - Whether QUIT should wait for release before responding.
 * @param {boolean} [args.requireAuth] - Whether MAIL FROM requires AUTH first.
 * @param {string} [args.idempotencyHeader] - Optional provider idempotency header name.
 * @returns {Promise<FakeSmtpServer>} - Fake SMTP server state.
 */
export async function startFakeSmtpServer({holdQuitResponse = false, idempotencyHeader, requireAuth = true} = {}) {
  const commands = []
  const messages = []
  const providerVisibleMessages = []
  /** @type {Map<string, string>} */
  const providerLedger = new Map()
  const sockets = new Set()
  let releaseQuitResponse = () => {}
  let resolveQuitReceived = () => {}
  const quitReceived = new Promise((resolve) => {
    resolveQuitReceived = resolve
  })
  const quitResponseReleased = holdQuitResponse ? new Promise((resolve) => {
    releaseQuitResponse = resolve
  }) : Promise.resolve()
  const server = net.createServer((socket) => {
    let authenticated = false
    let dataMode = false
    let dataBuffer = ""
    let lineBuffer = ""
    let pendingPlainAuth = false

    sockets.add(socket)
    socket.once("close", () => sockets.delete(socket))

    const write = (response) => socket.write(`${response}\r\n`)

    write("220 localhost")

    socket.on("data", (chunk) => {
      lineBuffer += chunk.toString("utf8")

      while (lineBuffer.includes("\n")) {
        const lineEndIndex = lineBuffer.indexOf("\n")
        const rawLine = lineBuffer.slice(0, lineEndIndex)
        const line = rawLine.replace(/\r$/, "")

        lineBuffer = lineBuffer.slice(lineEndIndex + 1)

        if (dataMode) {
          if (line === ".") {
            messages.push(dataBuffer)
            const idempotencyKey = idempotencyHeader ? headerValue(dataBuffer, idempotencyHeader) : null
            const existingMessage = idempotencyKey ? providerLedger.get(idempotencyKey) : null

            if (idempotencyKey && existingMessage && existingMessage !== dataBuffer) {
              dataBuffer = ""
              dataMode = false
              write("550 Idempotency key reused with different content")
              continue
            }
            if (!existingMessage) {
              providerVisibleMessages.push(dataBuffer)
              if (idempotencyKey) providerLedger.set(idempotencyKey, dataBuffer)
            }
            dataBuffer = ""
            dataMode = false
            write("250 Queued")
          } else {
            dataBuffer += `${line}\n`
          }

          continue
        }

        commands.push(line)

        if (pendingPlainAuth) {
          pendingPlainAuth = false
          const credentials = Buffer.from(line, "base64").toString("utf8")

          if (credentials === "\u0000robot\u0000secret") {
            authenticated = true
            write("235 2.7.0 Authentication successful")
          } else {
            write("535 5.7.8 Authentication failed")
          }

          continue
        }

        if (line.startsWith("EHLO") || line.startsWith("HELO")) {
          write("250-localhost")
          write("250 AUTH PLAIN")
        } else if (line === "AUTH PLAIN") {
          pendingPlainAuth = true
          write("334 ")
        } else if (line.startsWith("AUTH PLAIN ")) {
          const encodedCredentials = line.slice("AUTH PLAIN ".length)
          const credentials = Buffer.from(encodedCredentials, "base64").toString("utf8")

          if (credentials === "\u0000robot\u0000secret") {
            authenticated = true
            write("235 2.7.0 Authentication successful")
          } else {
            write("535 5.7.8 Authentication failed")
          }
        } else if (line.startsWith("MAIL FROM")) {
          if (requireAuth && !authenticated) {
            write("530 5.7.0 Authentication required")
          } else {
            write("250 OK")
          }
        } else if (line.startsWith("RCPT TO")) {
          write("250 OK")
        } else if (line === "DATA") {
          dataMode = true
          write("354 End data with <CR><LF>.<CR><LF>")
        } else if (line === "QUIT") {
          resolveQuitReceived()

          void quitResponseReleased.then(() => {
            write("221 Bye")
            socket.end()
          })
        } else {
          write("250 OK")
        }
      }
    })
  })

  const port = await listenOnLocalhost(server)

  return {
    close: async () => {
      releaseQuitResponse()

      for (const socket of sockets) socket.destroy()

      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
          } else {
            resolve(undefined)
          }
        })
      })
    },
    commands,
    messages,
    port,
    providerVisibleMessages,
    quitReceived,
    releaseQuitResponse
  }
}

/**
 * Reads one case-insensitive header from an SMTP DATA message.
 * @param {string} message - DATA payload.
 * @param {string} name - Header name.
 * @returns {string | null} - Header value or null.
 */
function headerValue(message, name) {
  const prefix = `${name.toLowerCase()}:`

  for (const line of message.split("\n")) {
    if (line.toLowerCase().startsWith(prefix)) return line.slice(line.indexOf(":") + 1).trim()
    if (line === "") break
  }

  return null
}
