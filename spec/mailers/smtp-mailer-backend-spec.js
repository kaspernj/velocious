// @ts-check

import wait from "awaitery/build/wait.js"

import SmtpMailerBackend from "../../src/mailer/backends/smtp.js"
import {startFakeSmtpServer} from "../helpers/fake-smtp-server.js"

describe("SmtpMailerBackend", {databaseCleaning: {transaction: true}}, () => {
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

  it("uses mailbox-only SMTP envelopes for display-name From headers", async () => {
    const fakeServer = await startFakeSmtpServer({requireAuth: false})

    try {
      const mailerBackend = new SmtpMailerBackend({
        connectionOptions: {
          host: "127.0.0.1",
          ignoreTLS: true,
          port: fakeServer.port,
          secure: false
        },
        defaultFrom: "Robot Sender <robot@example.com>"
      })

      await mailerBackend.deliver({
        payload: {
          action: "notice",
          html: "<p>SMTP smoke body</p>",
          mailer: "smtp",
          subject: "SMTP smoke subject",
          to: "receiver@example.com"
        }
      })

      expect(fakeServer.commands).toContain("MAIL FROM:<robot@example.com>")
      expect(fakeServer.messages[0]).toContain("From: Robot Sender <robot@example.com>")
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
