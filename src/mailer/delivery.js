// @ts-check

/**
 * Represents a prepared mail delivery.
 */
export default class MailerDelivery {
  /**
   * Narrows the runtime value to the documented type.
    @type {import("./base.js").VelociousMailerBase} */
  mailer
  /**
   * Narrows the runtime value to the documented type.
    @type {Promise<?>} */
  actionPromise
  /**
   * Narrows the runtime value to the documented type.
    @type {string} */
  actionName

  /**
   * Runs constructor.
   * @param {object} args - Constructor args.
   * @param {import("./base.js").VelociousMailerBase} args.mailer - Mailer instance.
   * @param {Promise<?>} args.actionPromise - Action promise.
   * @param {string} args.actionName - Action name.
   */
  constructor({mailer, actionPromise, actionName}) {
    this.mailer = mailer
    this.actionPromise = actionPromise
    this.actionName = actionName
  }

  /**
   * Runs build payload.
   * @returns {Promise<import("./index.js").MailerDeliveryPayload>} - Rendered mailer payload.
   */
  async buildPayload() {
    await this.actionPromise

    return /** Narrows the runtime value to the documented type. @type {import("./index.js").MailerDeliveryPayload} */ (await this.mailer._buildPayload())
  }

  /**
   * Runs deliver now.
   * @returns {Promise<import("./index.js").MailerDeliveryPayload | ?>} - Delivered payload or handler result.
   */
  async deliverNow() {
    const payload = await this.buildPayload()

    return await this.mailer._deliverPayload(payload)
  }

  /**
   * Runs deliver later.
   * @returns {Promise<string | import("./index.js").MailerDeliveryPayload | null>} - Job id or payload in test mode.
   */
  async deliverLater() {
    const payload = await this.buildPayload()

    return await this.mailer._enqueuePayload(payload)
  }

  /**
   * Runs deliver laver.
   * @returns {Promise<string | import("./index.js").MailerDeliveryPayload | null>} - Job id or payload in test mode.
   */
  async deliverLaver() {
    return await this.deliverLater()
  }
}
