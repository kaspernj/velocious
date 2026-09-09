export type MailerDeliveryOperationRequest = import("./mailer/index.js").MailerDeliveryOperationRequest;
export type MailerDeliveryOperation = import("./mailer/index.js").MailerDeliveryOperation;
export type MailerDeliveryIdempotencyCapability = import("./mailer/index.js").MailerDeliveryIdempotencyCapability;
export type MailerDeliveryLaterOptions = import("./mailer/index.js").MailerDeliveryLaterOptions;
export type MailerDeliveryPayload = import("./mailer/index.js").MailerDeliveryPayload;
/** @typedef {import("./mailer/index.js").MailerDeliveryOperationRequest} MailerDeliveryOperationRequest */
/** @typedef {import("./mailer/index.js").MailerDeliveryOperation} MailerDeliveryOperation */
/** @typedef {import("./mailer/index.js").MailerDeliveryIdempotencyCapability} MailerDeliveryIdempotencyCapability */
/** @typedef {import("./mailer/index.js").MailerDeliveryLaterOptions} MailerDeliveryLaterOptions */
/** @typedef {import("./mailer/index.js").MailerDeliveryPayload} MailerDeliveryPayload */
export { VelociousMailerBase, clearDeliveries, deliverPayload, deliveries, enqueuePayload, getDeliveryHandler, setDeliveryHandler } from "./mailer/index.js";
export { default as SmtpMailerBackend } from "./mailer/backends/smtp.js";
export { default as ResendSmtpMailerBackend } from "./mailer/backends/resend-smtp.js";
export { default } from "./mailer/index.js";
//# sourceMappingURL=mailer.d.ts.map