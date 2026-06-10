// @ts-check

/** @typedef {{to: ?, subject: string, from?: ?, cc?: ?, bcc?: ?, replyTo?: ?, headers?: Record<string, string>, html: string, mailer: string, action: string}} MailerDeliveryPayload */

import {
  clearDeliveries,
  deliverPayload,
  deliveries,
  enqueuePayload,
  getDeliveryHandler,
  setDeliveryHandler,
  VelociousMailerBase
} from "./base.js"

export {
  VelociousMailerBase,
  clearDeliveries,
  deliverPayload,
  deliveries,
  enqueuePayload,
  getDeliveryHandler,
  setDeliveryHandler
}
export default VelociousMailerBase
