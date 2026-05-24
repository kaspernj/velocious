// @ts-check

import restArgsError from "../../utils/rest-args-error.js"

/** @typedef {{auth?: Record<string, unknown>, [key: string]: unknown}} SmtpConnectionOptions */

/**
 * @param {any} value - Recipient input.
 * @returns {string[]} - Normalized recipients.
 */
function normalizeRecipients(value) {
  if (!value) return []
  if (Array.isArray(value)) return value.filter((entry) => entry)
  return [value].filter((entry) => entry)
}

/**
 * @param {string} name - Header name.
 * @param {string | undefined} value - Header value.
 * @returns {string | null} - Header line.
 */
function headerLine(name, value) {
  if (!value) return null

  return `${name}: ${value}`
}

/**
 * SMTP mailer backend using smtp-connection.
 */
export default class SmtpMailerBackend {
  /**
   * @param {object} args - Constructor args.
   * @param {SmtpConnectionOptions} args.connectionOptions - smtp-connection options.
   * @param {string} [args.defaultFrom] - Default from address.
   */
  constructor({connectionOptions, defaultFrom, ...restArgs}) {
    restArgsError(restArgs)

    if (!connectionOptions) {
      throw new Error(`Missing smtp connection options. Got: ${String(connectionOptions)}`)
    }

    this.connectionOptions = connectionOptions
    this.defaultFrom = defaultFrom
  }

  /**
   * @param {object} args - Delivery args.
   * @param {import("../index.js").MailerDeliveryPayload} args.payload - Mail delivery payload.
   * @param {import("../../configuration.js").default} [args.configuration] - Active configuration.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async deliver({payload, configuration: _configuration, ...restArgs}) {
    restArgsError(restArgs)

    const from = payload.from || this.defaultFrom

    if (!from) {
      throw new Error(`Missing mail "from" address. Got: ${String(from)}`)
    }

    const toList = normalizeRecipients(payload.to)
    const ccList = normalizeRecipients(payload.cc)
    const bccList = normalizeRecipients(payload.bcc)
    const recipients = [...toList, ...ccList, ...bccList]

    if (recipients.length === 0) {
      throw new Error(`Missing mail recipients. Got: ${JSON.stringify({to: payload.to, cc: payload.cc, bcc: payload.bcc})}`)
    }

    const headers = [
      headerLine("From", from),
      headerLine("To", toList.length > 0 ? toList.join(", ") : undefined),
      headerLine("Cc", ccList.length > 0 ? ccList.join(", ") : undefined),
      headerLine("Subject", payload.subject),
      "MIME-Version: 1.0",
      "Content-Type: text/html; charset=UTF-8"
    ].filter((line) => line)

    if (payload.headers) {
      for (const [headerName, headerValue] of Object.entries(payload.headers)) {
        headers.push(`${headerName}: ${headerValue}`)
      }
    }

    const message = `${headers.join("\r\n")}\r\n\r\n${payload.html}`
    const {default: SmtpConnection} = await import("smtp-connection")
    const connectionOptions = this.connectionOptions
    const connection = new SmtpConnection(connectionOptions)

    await new Promise((resolve, reject) => {
      let settled = false
      let shuttingDown = false

      const cleanup = () => {
        connection.removeListener("end", onEnd)
        connection.removeListener("error", onError)
      }

      const resolveDelivery = () => {
        if (settled) return

        settled = true
        cleanup()
        resolve(undefined)
      }

      /**
       * @param {Error} error - Error that failed delivery.
       */
      const rejectDelivery = (error) => {
        if (settled) return

        settled = true
        cleanup()
        connection.close()
        reject(error)
      }

      const onEnd = () => resolveDelivery()

      /**
       * @param {Error} error - Error emitted by the SMTP connection.
       */
      const onError = (error) => {
        if (shuttingDown) {
          resolveDelivery()
          return
        }

        rejectDelivery(error)
      }

      const quitAfterAcceptedMessage = () => {
        shuttingDown = true
        connection.once("end", onEnd)
        connection.quit()
      }

      const sendMessage = () => {
        connection.send({from, to: recipients}, /** @type {any} */ (message), (/** @type {Error | null | undefined} */ sendError) => {
          if (sendError) {
            rejectDelivery(sendError)
            return
          }

          quitAfterAcceptedMessage()
        })
      }

      const authenticateAndSend = () => {
        if (!connectionOptions.auth) {
          sendMessage()
          return
        }

        connection.login(connectionOptions.auth, (loginError) => {
          if (loginError) {
            rejectDelivery(loginError)
            return
          }

          sendMessage()
        })
      }

      connection.on("error", onError)
      connection.connect(authenticateAndSend)
    })
  }
}
