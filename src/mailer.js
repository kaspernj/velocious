// @ts-check

/** @typedef {{to: ?, subject: string, from?: ?, cc?: ?, bcc?: ?, replyTo?: ?, headers?: Record<string, string>, html: string, mailer: string, action: string}} MailerDeliveryPayload */

export {
  VelociousMailerBase,
  clearDeliveries,
  deliverPayload,
  deliveries,
  enqueuePayload,
  getDeliveryHandler,
  setDeliveryHandler
} from "./mailer/index.js"
export {default as SmtpMailerBackend} from "./mailer/backends/smtp.js"
export {default} from "./mailer/index.js"
