// @ts-check

import net from "net"
import wait from "awaitery/build/wait.js"

import SmtpMailerBackend from "../../src/mailer/backends/smtp.js"

/**
 * @typedef {object} FakeSmtpServer
 * @property {string[]} commands - Commands received by the server.
 * @property {() => Promise<void>} close - Closes the server.
 * @property {string[]} messages - DATA payloads accepted by the server.
 * @property {number} port - Listening port.
 * @property {Promise<void>} quitReceived - Resolves when the server receives QUIT.
 * @property {() => void} releaseQuitResponse - Allows a held QUIT response to continue.
 */

/**
 * @param {object} [args] - Server options.
 * @param {boolean} [args.holdQuitResponse] - Whether QUIT should wait for release before responding.
 * @param {boolean} [args.requireAuth] - Whether MAIL FROM requires AUTH first.
 * @returns {Promise<FakeSmtpServer>} - Fake SMTP server state.
 */
async function startFakeSmtpServer({holdQuitResponse = false, requireAuth = true} = {}) {
  const commands = []
  const messages = []
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

  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => resolve(undefined))
  })

  const address = server.address()

  if (!address || typeof address !== "object") {
    throw new Error("Fake SMTP server did not expose a TCP port.")
  }

  return {
    close: async () => {
      releaseQuitResponse()

      for (const socket of sockets) {
        socket.destroy()
      }

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
    port: address.port,
    quitReceived,
    releaseQuitResponse
  }
}

describe("SmtpMailerBackend", () => {
  it("authenticates before sending through authenticated SMTP servers", async () => {
    const fakeServer = await startFakeSmtpServer()

    try {
      const mailerBackend = new SmtpMailerBackend({
        connectionOptions: {
          auth: {user: "robot", pass: "secret"},
          host: "127.0.0.1",
          ignoreTLS: true,
          port: fakeServer.port,
          secure: false
        },
        defaultFrom: "robot@example.com"
      })

      await mailerBackend.deliver({
        configuration: /** @type {import("../../src/configuration.js").default} */ ({}),
        payload: {
          action: "notice",
          html: "<p>SMTP smoke body</p>",
          mailer: "smtp",
          subject: "SMTP smoke subject",
          to: "receiver@example.com"
        }
      })

      const authIndex = fakeServer.commands.findIndex((command) => command === "AUTH PLAIN" || command.startsWith("AUTH PLAIN "))
      const mailFromIndex = fakeServer.commands.findIndex((command) => command.startsWith("MAIL FROM"))

      expect(authIndex >= 0).toEqual(true)
      expect(mailFromIndex >= 0).toEqual(true)
      expect(authIndex < mailFromIndex).toEqual(true)
      expect(fakeServer.messages.length).toEqual(1)
      expect(fakeServer.messages[0]).toContain("Subject: SMTP smoke subject")
      expect(fakeServer.messages[0]).toContain("<p>SMTP smoke body</p>")
    } finally {
      await fakeServer.close()
    }
  })

  it("waits until graceful SMTP shutdown completes before resolving delivery", async () => {
    const fakeServer = await startFakeSmtpServer({holdQuitResponse: true})
    let resolved = false

    try {
      const mailerBackend = new SmtpMailerBackend({
        connectionOptions: {
          auth: {user: "robot", pass: "secret"},
          host: "127.0.0.1",
          ignoreTLS: true,
          port: fakeServer.port,
          secure: false
        },
        defaultFrom: "robot@example.com"
      })
      const deliverPromise = mailerBackend.deliver({
        payload: {
          action: "notice",
          html: "<p>SMTP smoke body</p>",
          mailer: "smtp",
          subject: "SMTP smoke subject",
          to: "receiver@example.com"
        }
      }).then(() => {
        resolved = true
      })

      await fakeServer.quitReceived
      await wait(0.01)

      expect(resolved).toEqual(false)

      fakeServer.releaseQuitResponse()
      await deliverPromise

      expect(resolved).toEqual(true)
    } finally {
      await fakeServer.close()
    }
  })
})
