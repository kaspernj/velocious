// @ts-check

/** @typedef {{to: any, subject: string, from?: any, cc?: any, bcc?: any, replyTo?: any, headers?: Record<string, string>, html: string, mailer: string, action: string}} MailerDeliveryPayload */

import {VelociousMailerBase} from "./base.js"

const VelociousMailer = new Proxy(VelociousMailerBase, {
  /**
   * @param {typeof VelociousMailerBase} target - Proxy target.
   * @param {string | symbol} prop - Property name.
   * @param {typeof VelociousMailerBase} receiver - Proxy receiver.
   * @returns {any} - Property value.
   */
  get(target, prop, receiver) {
    if (typeof prop !== "string" || prop in target) {
      return Reflect.get(target, prop, receiver)
    }

    return (...args) => {
      const instance = new receiver()

      return instance._buildDelivery(prop, args)
    }
  }
})

export {VelociousMailerBase}
export default VelociousMailer
