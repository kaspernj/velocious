export type MailerDeliveryOperationRequest = {
    id: string;
    idempotency: "required";
};
export type MailerDeliveryOperation = {
    id: string;
    idempotency: "required";
    payloadDigest: string;
    providerKind: string;
    providerRetentionMs: number;
};
export type MailerDeliveryIdempotencyCapability = {
    providerKind: string;
    retentionMs: number;
};
export type MailerDeliveryLaterOptions = {
    deliveryOperation?: MailerDeliveryOperationRequest;
};
export type MailerDeliveryPayload = {
    to: ReturnType<typeof JSON.parse>;
    subject: string;
    from?: ReturnType<typeof JSON.parse>;
    cc?: ReturnType<typeof JSON.parse>;
    bcc?: ReturnType<typeof JSON.parse>;
    replyTo?: ReturnType<typeof JSON.parse>;
    headers?: Record<string, string>;
    html: string;
    mailer: string;
    action: string;
    deliveryOperation?: MailerDeliveryOperation;
};
/** @typedef {{id: string, idempotency: "required"}} MailerDeliveryOperationRequest */
/** @typedef {{id: string, idempotency: "required", payloadDigest: string, providerKind: string, providerRetentionMs: number}} MailerDeliveryOperation */
/** @typedef {{providerKind: string, retentionMs: number}} MailerDeliveryIdempotencyCapability */
/** @typedef {{deliveryOperation?: MailerDeliveryOperationRequest}} MailerDeliveryLaterOptions */
/** @typedef {{to: ReturnType<typeof JSON.parse>, subject: string, from?: ReturnType<typeof JSON.parse>, cc?: ReturnType<typeof JSON.parse>, bcc?: ReturnType<typeof JSON.parse>, replyTo?: ReturnType<typeof JSON.parse>, headers?: Record<string, string>, html: string, mailer: string, action: string, deliveryOperation?: MailerDeliveryOperation}} MailerDeliveryPayload */
import { clearDeliveries, deliverPayload, deliveries, enqueuePayload, getDeliveryHandler, setDeliveryHandler, VelociousMailerBase } from "./base.js";
export { VelociousMailerBase, clearDeliveries, deliverPayload, deliveries, enqueuePayload, getDeliveryHandler, setDeliveryHandler };
export default VelociousMailerBase;
//# sourceMappingURL=index.d.ts.map