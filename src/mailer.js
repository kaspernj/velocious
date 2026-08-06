// @ts-check

/** @typedef {{to: ReturnType<typeof JSON.parse>, subject: string, from?: ReturnType<typeof JSON.parse>, cc?: ReturnType<typeof JSON.parse>, bcc?: ReturnType<typeof JSON.parse>, replyTo?: ReturnType<typeof JSON.parse>, headers?: Record<string, string>, html: string, mailer: string, action: string}} MailerDeliveryPayload */

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
