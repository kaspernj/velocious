// @ts-check

import ejs from "ejs"
import {incorporate} from "incorporator"
import * as inflection from "inflection"
import configurationResolver from "../configuration-resolver.js"
import restArgsError from "../utils/rest-args-error.js"
import MailerDelivery from "./delivery.js"

/** @type {import("./index.js").MailerDeliveryPayload[]} */
const deliveriesStore = []
/** @type {((payload: import("./index.js").MailerDeliveryPayload) => Promise<unknown> | unknown) | null} */
let deliveryHandler = null

/**
 * @param {string} actionName - Mailer action name.
 * @returns {string} - View file name.
 */
function viewFileName(actionName) {
  return inflection.dasherize(inflection.underscore(actionName))
}

/**
 * @param {string} className - Mailer class name.
 * @returns {string} - Mailer directory name.
 */
function mailerDirectoryName(className) {
  const baseName = className.replace(/Mailer$/, "")

  return inflection.dasherize(inflection.underscore(baseName))
}

/**
 * @returns {Promise<boolean>} - Whether the current environment is test.
 */
async function isTestingEnvironment() {
  const configuration = await configurationResolver()

  return configuration.getEnvironment() === "test"
}

/**
 * Base mailer with view rendering and delivery helpers.
 */
export class VelociousMailerBase {
  /**
   * @param {object} [args] - Constructor args.
   * @param {import("../configuration.js").default} [args.configuration] - Configuration instance.
   */
  constructor({configuration} = {}) {
    this._actionName = null
    this._mailOptions = null
    this._viewParams = {}
    this._configurationPromise = configuration ? Promise.resolve(configuration) : configurationResolver()
  }

  /**
   * @param {Record<string, any>} params - View params.
   * @returns {void} - No return value.
   */
  assignView(params) {
    this._viewParams = Object.assign(this._viewParams, params || {})
  }

  /**
   * @param {object} args - Mail options.
   * @param {any} args.to - Recipient.
   * @param {string} args.subject - Subject line.
   * @param {any} [args.from] - Sender.
   * @param {any} [args.cc] - CC recipients.
   * @param {any} [args.bcc] - BCC recipients.
   * @param {any} [args.replyTo] - Reply-to address.
   * @param {Record<string, string>} [args.headers] - Custom headers.
   * @param {string} args.actionName - Mailer action name.
   * @param {Promise<unknown> | unknown} [args.actionPromise] - Action completion promise.
   * @returns {MailerDelivery} - Delivery wrapper.
   */
  mail({to, subject, from, cc, bcc, replyTo, headers, actionName, actionPromise, ...restArgs}) {
    restArgsError(restArgs)

    if (!actionName) {
      throw new Error(`Missing actionName for ${this.constructor.name}.mail()`)
    }

    this._actionName = actionName
    this._mailOptions = {to, subject, from, cc, bcc, replyTo, headers}
    const resolvedActionPromise = actionPromise === undefined ? Promise.resolve() : Promise.resolve(actionPromise)

    return new MailerDelivery({
      mailer: this,
      actionPromise: resolvedActionPromise,
      actionName
    })
  }

  /**
   * @returns {Promise<import("../configuration.js").default>} - Configuration instance.
   */
  async _getConfiguration() {
    return await this._configurationPromise
  }

  /**
   * @returns {string} - Action name.
   */
  _getActionName() {
    if (!this._actionName) {
      throw new Error(`No mailer action set on ${this.constructor.name}`)
    }

    return this._actionName
  }

  /**
   * @param {string} html - Rendered HTML.
   * @returns {import("./index.js").MailerDeliveryPayload} - Delivery payload.
   */
  _buildPayloadSync(html) {
    const mailOptions = this._mailOptions

    if (!mailOptions) {
      throw new Error(`Missing mail() options for ${this.constructor.name}#${this._getActionName()}. Got: ${String(mailOptions)}`)
    }

    if (!mailOptions.to) {
      throw new Error(`Missing "to" for ${this.constructor.name}#${this._getActionName()}. Got: ${String(mailOptions.to)}`)
    }

    if (!mailOptions.subject) {
      throw new Error(`Missing "subject" for ${this.constructor.name}#${this._getActionName()}. Got: ${String(mailOptions.subject)}`)
    }

    return {
      to: mailOptions.to,
      subject: mailOptions.subject,
      from: mailOptions.from,
      cc: mailOptions.cc,
      bcc: mailOptions.bcc,
      replyTo: mailOptions.replyTo,
      headers: mailOptions.headers,
      html,
      mailer: this.constructor.name,
      action: this._getActionName()
    }
  }

  /**
   * @returns {Promise<import("./index.js").MailerDeliveryPayload>} - Delivery payload.
   */
  async _buildPayload() {
    const html = await this._renderView()

    return this._buildPayloadSync(html)
  }

  /**
   * @returns {Promise<string>} - Rendered HTML.
   */
  async _renderView() {
    const configuration = await this._getConfiguration()
    const mailerDir = mailerDirectoryName(this.constructor.name)
    const actionName = this._getActionName()
    const fileName = viewFileName(actionName)
    const viewPath = `${configuration.getDirectory()}/src/mailers/${mailerDir}/${fileName}.ejs`
    const translate = (msgID, args) => configuration.getTranslator()(msgID, args)
    const viewParams = incorporate({mailer: this, _: translate}, this._viewParams)

    return await new Promise((resolve, reject) => {
      ejs.renderFile(viewPath, viewParams, {}, (err, str) => {
        if (err) {
          const errorCode = /** @type {{code?: string}} */ (err).code

          if (errorCode === "ENOENT") {
            reject(new Error(`Missing mailer view file: ${viewPath}`))
          } else {
            reject(err)
          }
        } else {
          resolve(str)
        }
      })
    })
  }

  /**
   * @param {import("./index.js").MailerDeliveryPayload} payload - Mail delivery payload.
   * @returns {Promise<import("./index.js").MailerDeliveryPayload | unknown>} - Handler result.
   */
  async _deliverPayload(payload) {
    return await deliverPayload(payload)
  }

  /**
   * @param {import("./index.js").MailerDeliveryPayload} payload - Mail delivery payload.
   * @returns {Promise<string | import("./index.js").MailerDeliveryPayload | null>} - Job id or payload in test mode.
   */
  async _enqueuePayload(payload) {
    return await enqueuePayload(payload)
  }
}

/**
 * @returns {import("./index.js").MailerDeliveryPayload[]} - Delivered payloads.
 */
export function deliveries() {
  return deliveriesStore.slice()
}

/**
 * @returns {void} - No return value.
 */
export function clearDeliveries() {
  deliveriesStore.length = 0
}

/**
 * @param {(payload: import("./index.js").MailerDeliveryPayload) => Promise<unknown> | unknown} handler - Delivery handler.
 * @returns {void} - No return value.
 */
export function setDeliveryHandler(handler) {
  deliveryHandler = handler
}

/**
 * @returns {(payload: import("./index.js").MailerDeliveryPayload) => Promise<unknown> | unknown | null} - Handler or null.
 */
export function getDeliveryHandler() {
  return deliveryHandler
}

/**
 * @param {import("./index.js").MailerDeliveryPayload} payload - Mail delivery payload.
 * @returns {Promise<import("./index.js").MailerDeliveryPayload | unknown>} - Handler result.
 */
export async function deliverPayload(payload) {
  if (await isTestingEnvironment()) {
    deliveriesStore.push(payload)
    return payload
  }

  const configuration = await configurationResolver()
  const backend = configuration.getMailerBackend()

  if (backend?.deliver) {
    return await backend.deliver({payload, configuration})
  }

  const handler = deliveryHandler

  if (!handler) {
    throw new Error(`No mail delivery handler configured for "${payload.subject}" to "${payload.to}"`)
  }

  return await handler(payload)
}

/**
 * @param {import("./index.js").MailerDeliveryPayload} payload - Mail delivery payload.
 * @returns {Promise<string | import("./index.js").MailerDeliveryPayload | null>} - Job id or payload in test mode.
 */
export async function enqueuePayload(payload) {
  if (await isTestingEnvironment()) {
    deliveriesStore.push(payload)
    return payload
  }

  const {default: mailDeliveryJob} = await import("../jobs/mail-delivery.js")

  return await mailDeliveryJob.performLater(payload)
}
