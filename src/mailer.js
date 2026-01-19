// @ts-check

/** @typedef {{to: any, subject: string, from?: any, cc?: any, bcc?: any, replyTo?: any, headers?: Record<string, string>, html: string, mailer: string, action: string}} MailerDeliveryPayload */

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
