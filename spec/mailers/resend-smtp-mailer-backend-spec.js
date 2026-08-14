// @ts-check

import ResendSmtpMailerBackend from "../../src/mailer/backends/resend-smtp.js"
import {startFakeSmtpServer} from "../helpers/fake-smtp-server.js"

/**
 * Builds one persisted required-operation payload.
 * @param {string} [id] - Operation id.
 * @returns {import("../../src/mailer.js").MailerDeliveryPayload} - Payload.
 */
function operationPayload(id = "welcome-user/123456789") {
  return {
    action: "notice",
    deliveryOperation: {
      id,
      idempotency: "required",
      payloadDigest: "sha256:v1:test-payload",
      providerKind: "resend-smtp",
      providerRetentionMs: 86_400_000
    },
    from: "robot@example.com",
    html: "<p>SMTP idempotency body</p>",
    mailer: "ResendSpecMailer",
    subject: "SMTP idempotency subject",
    to: "receiver@example.com"
  }
}

describe("ResendSmtpMailerBackend", {databaseCleaning: {transaction: true}}, () => {
  it("advertises the explicit provider capability and injects the stable operation key", async () => {
    const fakeServer = await startFakeSmtpServer({requireAuth: false})

    try {
      const backend = new ResendSmtpMailerBackend({
        connectionOptions: {host: "127.0.0.1", ignoreTLS: true, port: fakeServer.port, secure: false}
      })
      const payload = operationPayload()

      expect(backend.deliveryIdempotencyCapability()).toEqual({providerKind: "resend-smtp", retentionMs: 86_400_000})

      await backend.deliver({payload})
      await backend.deliver({payload})

      expect(fakeServer.messages.length).toEqual(2)
      expect(fakeServer.messages[0]).toContain("Resend-Idempotency-Key: welcome-user/123456789")
      expect(fakeServer.messages[1]).toEqual(fakeServer.messages[0])
      expect(new Set(fakeServer.messages.map((message) => message.match(/Resend-Idempotency-Key: ([^\n]+)/)?.[1])).size).toEqual(1)
    } finally {
      await fakeServer.close()
    }
  })

  it("resolves the configured default sender before immutable payload hashing", () => {
    const backend = new ResendSmtpMailerBackend({
      connectionOptions: {host: "127.0.0.1", port: 2525, secure: false},
      defaultFrom: "default-sender@example.com"
    })
    const prepared = backend.prepareDeliveryOperationPayload({payload: {...operationPayload(), from: undefined}})

    expect(prepared.from).toEqual("default-sender@example.com")
    expect(operationPayload().from).toEqual("robot@example.com")
  })

  it("rejects caller-controlled reserved headers case-insensitively before connecting", async () => {
    const fakeServer = await startFakeSmtpServer({requireAuth: false})

    try {
      const backend = new ResendSmtpMailerBackend({
        connectionOptions: {host: "127.0.0.1", ignoreTLS: true, port: fakeServer.port, secure: false}
      })

      await expect(async () => await backend.deliver({
        payload: {...operationPayload(), headers: {"rEsEnD-IdEmPoTeNcY-kEy": "caller-value"}}
      })).toThrow(/reserved.*Resend-Idempotency-Key/i)
      await expect(async () => await backend.deliver({
        payload: {...operationPayload(), deliveryOperation: undefined, headers: {"RESEND-IDEMPOTENCY-KEY": "caller-value"}}
      })).toThrow(/reserved.*Resend-Idempotency-Key/i)

      expect(fakeServer.commands).toEqual([])
      expect(fakeServer.messages).toEqual([])
    } finally {
      await fakeServer.close()
    }
  })

  it("validates Resend's documented 1-256 character key contract before connecting", async () => {
    const fakeServer = await startFakeSmtpServer({requireAuth: false})

    try {
      const backend = new ResendSmtpMailerBackend({
        connectionOptions: {host: "127.0.0.1", ignoreTLS: true, port: fakeServer.port, secure: false}
      })

      await expect(async () => await backend.deliver({payload: operationPayload("")})).toThrow(/1.*256/)
      await expect(async () => await backend.deliver({payload: operationPayload("x".repeat(257))})).toThrow(/1.*256/)
      expect(fakeServer.commands).toEqual([])
    } finally {
      await fakeServer.close()
    }
  })

  it("rejects SMTP header-value control characters before connecting", async () => {
    const fakeServer = await startFakeSmtpServer({requireAuth: false})

    try {
      const backend = new ResendSmtpMailerBackend({
        connectionOptions: {host: "127.0.0.1", ignoreTLS: true, port: fakeServer.port, secure: false}
      })
      const controlCharacters = [
        ...Array.from({length: 32}, (_, codePoint) => String.fromCodePoint(codePoint)),
        ...Array.from({length: 33}, (_, offset) => String.fromCodePoint(0x7f + offset))
      ]

      for (const controlCharacter of controlCharacters) {
        await expect(async () => await backend.deliver({payload: operationPayload(`prefix${controlCharacter}suffix`)}))
          .toThrow(/control characters/i)
      }

      let error = /** @type {import("../../src/velocious-error.js").default | null} */ (null)

      try {
        backend.validateDeliveryOperation({
          deliveryOperation: operationPayload("unsafe\r\nInjected: true").deliveryOperation,
          payload: operationPayload()
        })
      } catch (newError) {
        error = /** @type {import("../../src/velocious-error.js").default} */ (newError)
      }

      if (!error) throw new Error("Expected a safe Resend idempotency-key validation error")
      expect(error.code).toEqual("mail-delivery-idempotency-key-invalid")
      expect(error.safeToExpose).toEqual(true)

      expect(fakeServer.commands).toEqual([])
      expect(fakeServer.messages).toEqual([])
    } finally {
      await fakeServer.close()
    }
  })
})
