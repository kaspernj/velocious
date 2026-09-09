// @ts-check
import ejs from "ejs";
import { incorporate } from "incorporator";
import * as inflection from "inflection";
import BackgroundJobsClient from "../background-jobs/client.js";
import configurationResolver from "../configuration-resolver.js";
import restArgsError from "../utils/rest-args-error.js";
import MailerDelivery from "./delivery.js";
import MailerDeliveryOperationStore from "./delivery-operation-store.js";
import { deliveryOperationFromPayload, prepareRequiredDeliveryPayload, requireDeliveryIdempotencyCapability } from "./delivery-operation.js";
/**
 * Deliveries store.
 * @type {import("./index.js").MailerDeliveryPayload[]} */
const deliveriesStore = [];
/**
 * Delivery handler.
 * @type {((payload: import("./index.js").MailerDeliveryPayload) => Promise<ReturnType<typeof JSON.parse>> | ReturnType<typeof JSON.parse>) | null} */
let deliveryHandler = null;
/**
 * Runs view file name.
 * @param {string} actionName - Mailer action name.
 * @returns {string} - View file name.
 */
function viewFileName(actionName) {
    return inflection.dasherize(inflection.underscore(actionName));
}
/**
 * Runs mailer directory name.
 * @param {string} className - Mailer class name.
 * @returns {string} - Mailer directory name.
 */
function mailerDirectoryName(className) {
    const baseName = className.replace(/Mailer$/, "");
    return inflection.dasherize(inflection.underscore(baseName));
}
/**
 * Runs the inferActionName helper.
 * @param {typeof VelociousMailerBase} mailerClass - Mailer class.
 * @param {string} stack - Error stack.
 * @returns {string | null} - Inferred action name.
 */
// fallow-ignore-next-line complexity
function inferActionName(mailerClass, stack) {
    const prototype = mailerClass.prototype;
    let actionName = null;
    for (const line of stack.split("\n")) {
        const match = line.match(/\bat (?:async )?(?:new )?[^\s.]+\.([^\s.]+) /);
        if (!match)
            continue;
        const frameActionName = match[1];
        if (frameActionName === "mail")
            continue;
        if (frameActionName.startsWith("_"))
            continue;
        if (frameActionName === "constructor")
            continue;
        if (Object.prototype.hasOwnProperty.call(VelociousMailerBase.prototype, frameActionName))
            continue;
        if (typeof /** @type {Record<string, ReturnType<typeof JSON.parse>>} */ ( /** @type {ReturnType<typeof JSON.parse>} */(prototype))[frameActionName] !== "function")
            continue;
        actionName = frameActionName;
    }
    return actionName;
}
/**
 * Base mailer with view rendering and delivery helpers.
 */
export class VelociousMailerBase {
    /**
     * Runs constructor.
     * @param {object} [args] - Constructor args.
     * @param {import("../configuration.js").default} [args.configuration] - Configuration instance.
     */
    constructor({ configuration } = {}) {
        this._actionName = null;
        this._mailOptions = null;
        this._viewParams = {};
        this._configurationPromise = configuration ? Promise.resolve(configuration) : configurationResolver();
    }
    /**
     * Runs assign view.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} params - View params.
     * @returns {void} - No return value.
     */
    assignView(params) {
        this._viewParams = Object.assign(this._viewParams, params || {});
    }
    /**
     * Runs mail.
     * @param {object} args - Mail options.
     * @param {ReturnType<typeof JSON.parse>} args.to - Recipient.
     * @param {string} args.subject - Subject line.
     * @param {ReturnType<typeof JSON.parse>} [args.from] - Sender.
     * @param {ReturnType<typeof JSON.parse>} [args.cc] - CC recipients.
     * @param {ReturnType<typeof JSON.parse>} [args.bcc] - BCC recipients.
     * @param {ReturnType<typeof JSON.parse>} [args.replyTo] - Reply-to address.
     * @param {Record<string, string>} [args.headers] - Custom headers.
     * @param {string} [args.actionName] - Mailer action name.
     * @param {Promise<ReturnType<typeof JSON.parse>> | ReturnType<typeof JSON.parse>} [args.actionPromise] - Action completion promise.
     * @returns {MailerDelivery} - Delivery wrapper.
     */
    mail({ to, subject, from, cc, bcc, replyTo, headers, actionName, actionPromise, ...restArgs }) {
        restArgsError(restArgs);
        const resolvedActionName = actionName || inferActionName(/** @type {typeof VelociousMailerBase} */ (this.constructor), new Error().stack || "");
        if (!resolvedActionName) {
            throw new Error(`Missing actionName for ${this.constructor.name}.mail()`);
        }
        this._actionName = resolvedActionName;
        this._mailOptions = { to, subject, from, cc, bcc, replyTo, headers };
        const resolvedActionPromise = actionPromise === undefined ? Promise.resolve() : Promise.resolve(actionPromise);
        return new MailerDelivery({
            mailer: this,
            actionPromise: resolvedActionPromise,
            actionName: resolvedActionName
        });
    }
    /**
     * Runs get configuration.
     * @returns {Promise<import("../configuration.js").default>} - Configuration instance.
     */
    async _getConfiguration() {
        return await this._configurationPromise;
    }
    /**
     * Runs get action name.
     * @returns {string} - Action name.
     */
    _getActionName() {
        if (!this._actionName) {
            throw new Error(`No mailer action set on ${this.constructor.name}`);
        }
        return this._actionName;
    }
    /**
     * Runs build payload sync.
     * @param {string} html - Rendered HTML.
     * @returns {import("./index.js").MailerDeliveryPayload} - Delivery payload.
     */
    _buildPayloadSync(html) {
        const mailOptions = this._mailOptions;
        if (!mailOptions) {
            throw new Error(`Missing mail() options for ${this.constructor.name}#${this._getActionName()}. Got: ${String(mailOptions)}`);
        }
        if (!mailOptions.to) {
            throw new Error(`Missing "to" for ${this.constructor.name}#${this._getActionName()}. Got: ${String(mailOptions.to)}`);
        }
        if (!mailOptions.subject) {
            throw new Error(`Missing "subject" for ${this.constructor.name}#${this._getActionName()}. Got: ${String(mailOptions.subject)}`);
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
        };
    }
    /**
     * Runs build payload.
     * @returns {Promise<import("./index.js").MailerDeliveryPayload>} - Delivery payload.
     */
    async _buildPayload() {
        const html = await this._renderView();
        return this._buildPayloadSync(html);
    }
    /**
     * Runs render view.
     * @returns {Promise<string>} - Rendered HTML.
     */
    async _renderView() {
        const configuration = await this._getConfiguration();
        const mailerDir = mailerDirectoryName(this.constructor.name);
        const actionName = this._getActionName();
        const fileName = viewFileName(actionName);
        const viewPath = `${configuration.getDirectory()}/src/mailers/${mailerDir}/${fileName}.ejs`;
        const translate = (/** @type {string} */ msgID, /** @type {Record<string, ReturnType<typeof JSON.parse>> | undefined} */ args) => configuration.getTranslator()(msgID, args);
        const viewParams = incorporate({ mailer: this, _: translate }, this._viewParams);
        return await new Promise((resolve, reject) => {
            ejs.renderFile(viewPath, viewParams, {}, (err, str) => {
                if (err) {
                    const errorCode = /** @type {{code?: string}} */ (err).code;
                    if (errorCode === "ENOENT") {
                        reject(new Error(`Missing mailer view file: ${viewPath}`));
                    }
                    else {
                        reject(err);
                    }
                }
                else {
                    resolve(str);
                }
            });
        });
    }
    /**
     * Runs deliver payload.
     * @param {import("./index.js").MailerDeliveryPayload} payload - Mail delivery payload.
     * @returns {Promise<import("./index.js").MailerDeliveryPayload | ReturnType<typeof JSON.parse>>} - Handler result.
     */
    async _deliverPayload(payload) {
        return await deliverPayload(payload);
    }
    /**
     * Runs enqueue payload.
     * @param {import("./index.js").MailerDeliveryPayload} payload - Mail delivery payload.
     * @param {import("./index.js").MailerDeliveryLaterOptions} [options] - Delivery execution options.
     * @returns {Promise<string | import("./index.js").MailerDeliveryPayload | null>} - Job id or payload in test mode.
     */
    async _enqueuePayload(payload, options) {
        const configuration = await this._getConfiguration();
        return await enqueuePayload(payload, { ...options, configuration });
    }
}
/**
 * Runs the deliveries helper.
 * @returns {import("./index.js").MailerDeliveryPayload[]} - Delivered payloads.
 */
export function deliveries() {
    return deliveriesStore.slice();
}
/**
 * Runs the clearDeliveries helper.
 * @returns {void} - No return value.
 */
export function clearDeliveries() {
    deliveriesStore.length = 0;
}
/**
 * Runs the setDeliveryHandler helper.
 * @param {(payload: import("./index.js").MailerDeliveryPayload) => Promise<ReturnType<typeof JSON.parse>> | ReturnType<typeof JSON.parse>} handler - Delivery handler.
 * @returns {void} - No return value.
 */
export function setDeliveryHandler(handler) {
    deliveryHandler = handler;
}
/**
 * Runs the getDeliveryHandler helper.
 * @returns {((payload: import("./index.js").MailerDeliveryPayload) => Promise<ReturnType<typeof JSON.parse>> | ReturnType<typeof JSON.parse>) | null} - Handler or null.
 */
export function getDeliveryHandler() {
    return deliveryHandler;
}
/**
 * Runs the deliverPayload helper.
 * @param {import("./index.js").MailerDeliveryPayload} payload - Mail delivery payload.
 * @returns {Promise<import("./index.js").MailerDeliveryPayload | ReturnType<typeof JSON.parse>>} - Handler result.
 */
export async function deliverPayload(payload) {
    const configuration = await configurationResolver();
    const backend = configuration.getMailerBackend();
    const deliveryOperation = deliveryOperationFromPayload(payload);
    if (deliveryOperation) {
        const capability = requireDeliveryIdempotencyCapability({ backend, deliveryOperation, payload });
        const operationStore = new MailerDeliveryOperationStore({ configuration });
        await operationStore.beginAttempt({ capability, payload });
    }
    if (configuration.getEnvironment() === "test") {
        deliveriesStore.push(payload);
        return payload;
    }
    if (backend?.deliver) {
        return await backend.deliver({ payload, configuration });
    }
    const handler = deliveryHandler;
    if (!handler) {
        throw new Error(`No mail delivery handler configured for "${payload.subject}" to "${payload.to}"`);
    }
    return await handler(payload);
}
/**
 * Runs the enqueuePayload helper.
 * @param {import("./index.js").MailerDeliveryPayload} payload - Mail delivery payload.
 * @param {object} [options] - Enqueue options.
 * @param {import("../configuration.js").default} [options.configuration] - Owning configuration.
 * @param {import("./index.js").MailerDeliveryOperationRequest} [options.deliveryOperation] - Required provider-backed operation.
 * @returns {Promise<string | import("./index.js").MailerDeliveryPayload | null>} - Job id or payload in test mode.
 */
export async function enqueuePayload(payload, { configuration: suppliedConfiguration, deliveryOperation } = {}) {
    const configuration = suppliedConfiguration || await configurationResolver();
    let persistedPayload = payload;
    if (deliveryOperation) {
        const backend = configuration.getMailerBackend();
        const operationPayload = typeof backend?.prepareDeliveryOperationPayload === "function"
            ? backend.prepareDeliveryOperationPayload({ payload })
            : payload;
        const capability = requireDeliveryIdempotencyCapability({ backend, deliveryOperation, payload: operationPayload });
        persistedPayload = prepareRequiredDeliveryPayload({ capability, deliveryOperation, payload: operationPayload });
    }
    if (configuration.getEnvironment() === "test") {
        deliveriesStore.push(persistedPayload);
        return persistedPayload;
    }
    const { default: mailDeliveryJob } = await import("../jobs/mail-delivery.js");
    const client = new BackgroundJobsClient({ configuration });
    const jobOptions = mailDeliveryJob._withQueue(deliveryOperation ? { idempotencyKey: deliveryOperation.id } : undefined);
    return await client.enqueue({
        args: [persistedPayload],
        jobName: mailDeliveryJob.jobName(),
        options: jobOptions
    });
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiYmFzZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9tYWlsZXIvYmFzZS5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxHQUFHLE1BQU0sS0FBSyxDQUFBO0FBQ3JCLE9BQU8sRUFBQyxXQUFXLEVBQUMsTUFBTSxjQUFjLENBQUE7QUFDeEMsT0FBTyxLQUFLLFVBQVUsTUFBTSxZQUFZLENBQUE7QUFDeEMsT0FBTyxvQkFBb0IsTUFBTSw4QkFBOEIsQ0FBQTtBQUMvRCxPQUFPLHFCQUFxQixNQUFNLDhCQUE4QixDQUFBO0FBQ2hFLE9BQU8sYUFBYSxNQUFNLDZCQUE2QixDQUFBO0FBQ3ZELE9BQU8sY0FBYyxNQUFNLGVBQWUsQ0FBQTtBQUMxQyxPQUFPLDRCQUE0QixNQUFNLCtCQUErQixDQUFBO0FBQ3hFLE9BQU8sRUFDTCw0QkFBNEIsRUFDNUIsOEJBQThCLEVBQzlCLG9DQUFvQyxFQUNyQyxNQUFNLHlCQUF5QixDQUFBO0FBRWhDOzswREFFMEQ7QUFDMUQsTUFBTSxlQUFlLEdBQUcsRUFBRSxDQUFBO0FBQzFCOztzSkFFc0o7QUFDdEosSUFBSSxlQUFlLEdBQUcsSUFBSSxDQUFBO0FBRTFCOzs7O0dBSUc7QUFDSCxTQUFTLFlBQVksQ0FBQyxVQUFVO0lBQzlCLE9BQU8sVUFBVSxDQUFDLFNBQVMsQ0FBQyxVQUFVLENBQUMsVUFBVSxDQUFDLFVBQVUsQ0FBQyxDQUFDLENBQUE7QUFDaEUsQ0FBQztBQUVEOzs7O0dBSUc7QUFDSCxTQUFTLG1CQUFtQixDQUFDLFNBQVM7SUFDcEMsTUFBTSxRQUFRLEdBQUcsU0FBUyxDQUFDLE9BQU8sQ0FBQyxTQUFTLEVBQUUsRUFBRSxDQUFDLENBQUE7SUFFakQsT0FBTyxVQUFVLENBQUMsU0FBUyxDQUFDLFVBQVUsQ0FBQyxVQUFVLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQTtBQUM5RCxDQUFDO0FBRUQ7Ozs7O0dBS0c7QUFDSCxxQ0FBcUM7QUFDckMs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QUMsT0FBTyxFQUFFLGlCQUFpQixFQUFFLE9BQU8sRUFBRSxnQkFBZ0IsRUFBQyxDQUFDLENBQUE7UUFFaEgsZ0JBQWdCLEdBQUcsOEJBQThCLENBQUMsRUFBQyxVQUFVLEVBQUUsaUJBQWlCLEVBQUUsT0FBTyxFQUFFLGdCQUFnQixFQUFDLENBQUMsQ0FBQTtJQUMvRyxDQUFDO0lBRUQsSUFBSSxhQUFhLENBQUMsY0FBYyxFQUFFLEtBQUssTUFBTSxFQUFFLENBQUM7UUFDOUMsZUFBZSxDQUFDLElBQUksQ0FBQyxnQkFBZ0IsQ0FBQyxDQUFBO1FBQ3RDLE9BQU8sZ0JBQWdCLENBQUE7SUFDekIsQ0FBQztJQUVELE1BQU0sRUFBQyxPQUFPLEVBQUUsZUFBZSxFQUFDLEdBQUcsTUFBTSxNQUFNLENBQUMsMEJBQTBCLENBQUMsQ0FBQTtJQUMzRSxNQUFNLE1BQU0sR0FBRyxJQUFJLG9CQUFvQixDQUFDLEVBQUMsYUFBYSxFQUFDLENBQUMsQ0FBQTtJQUN4RCxNQUFNLFVBQVUsR0FBRyxlQUFlLENBQUMsVUFBVSxDQUFDLGlCQUFpQixDQUFDLENBQUMsQ0FBQyxFQUFDLGNBQWMsRUFBRSxpQkFBaUIsQ0FBQyxFQUFFLEVBQUMsQ0FBQyxDQUFDLENBQUMsU0FBUyxDQUFDLENBQUE7SUFFckgsT0FBTyxNQUFNLE1BQU0sQ0FBQyxPQUFPLENBQUM7UUFDMUIsSUFBSSxFQUFFLENBQUMsZ0JBQWdCLENBQUM7UUFDeEIsT0FBTyxFQUFFLGVBQWUsQ0FBQyxPQUFPLEVBQUU7UUFDbEMsT0FBTyxFQUFFLFVBQVU7S0FDcEIsQ0FBQyxDQUFBO0FBQ0osQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIi8vIEB0cy1jaGVja1xuXG5pbXBvcnQgZWpzIGZyb20gXCJlanNcIlxuaW1wb3J0IHtpbmNvcnBvcmF0ZX0gZnJvbSBcImluY29ycG9yYXRvclwiXG5pbXBvcnQgKiBhcyBpbmZsZWN0aW9uIGZyb20gXCJpbmZsZWN0aW9uXCJcbmltcG9ydCBCYWNrZ3JvdW5kSm9ic0NsaWVudCBmcm9tIFwiLi4vYmFja2dyb3VuZC1qb2JzL2NsaWVudC5qc1wiXG5pbXBvcnQgY29uZmlndXJhdGlvblJlc29sdmVyIGZyb20gXCIuLi9jb25maWd1cmF0aW9uLXJlc29sdmVyLmpzXCJcbmltcG9ydCByZXN0QXJnc0Vycm9yIGZyb20gXCIuLi91dGlscy9yZXN0LWFyZ3MtZXJyb3IuanNcIlxuaW1wb3J0IE1haWxlckRlbGl2ZXJ5IGZyb20gXCIuL2RlbGl2ZXJ5LmpzXCJcbmltcG9ydCBNYWlsZXJEZWxpdmVyeU9wZXJhdGlvblN0b3JlIGZyb20gXCIuL2RlbGl2ZXJ5LW9wZXJhdGlvbi1zdG9yZS5qc1wiXG5pbXBvcnQge1xuICBkZWxpdmVyeU9wZXJhdGlvbkZyb21QYXlsb2FkLFxuICBwcmVwYXJlUmVxdWlyZWREZWxpdmVyeVBheWxvYWQsXG4gIHJlcXVpcmVEZWxpdmVyeUlkZW1wb3RlbmN5Q2FwYWJpbGl0eVxufSBmcm9tIFwiLi9kZWxpdmVyeS1vcGVyYXRpb24uanNcIlxuXG4vKipcbiAqIERlbGl2ZXJpZXMgc3RvcmUuXG4gKiBAdHlwZSB7aW1wb3J0KFwiLi9pbmRleC5qc1wiKS5NYWlsZXJEZWxpdmVyeVBheWxvYWRbXX0gKi9cbmNvbnN0IGRlbGl2ZXJpZXNTdG9yZSA9IFtdXG4vKipcbiAqIERlbGl2ZXJ5IGhhbmRsZXIuXG4gKiBAdHlwZSB7KChwYXlsb2FkOiBpbXBvcnQoXCIuL2luZGV4LmpzXCIpLk1haWxlckRlbGl2ZXJ5UGF5bG9hZCkgPT4gUHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPikgfCBudWxsfSAqL1xubGV0IGRlbGl2ZXJ5SGFuZGxlciA9IG51bGxcblxuLyoqXG4gKiBSdW5zIHZpZXcgZmlsZSBuYW1lLlxuICogQHBhcmFtIHtzdHJpbmd9IGFjdGlvbk5hbWUgLSBNYWlsZXIgYWN0aW9uIG5hbWUuXG4gKiBAcmV0dXJucyB7c3RyaW5nfSAtIFZpZXcgZmlsZSBuYW1lLlxuICovXG5mdW5jdGlvbiB2aWV3RmlsZU5hbWUoYWN0aW9uTmFtZSkge1xuICByZXR1cm4gaW5mbGVjdGlvbi5kYXNoZXJpemUoaW5mbGVjdGlvbi51bmRlcnNjb3JlKGFjdGlvbk5hbWUpKVxufVxuXG4vKipcbiAqIFJ1bnMgbWFpbGVyIGRpcmVjdG9yeSBuYW1lLlxuICogQHBhcmFtIHtzdHJpbmd9IGNsYXNzTmFtZSAtIE1haWxlciBjbGFzcyBuYW1lLlxuICogQHJldHVybnMge3N0cmluZ30gLSBNYWlsZXIgZGlyZWN0b3J5IG5hbWUuXG4gKi9cbmZ1bmN0aW9uIG1haWxlckRpcmVjdG9yeU5hbWUoY2xhc3NOYW1lKSB7XG4gIGNvbnN0IGJhc2VOYW1lID0gY2xhc3NOYW1lLnJlcGxhY2UoL01haWxlciQvLCBcIlwiKVxuXG4gIHJldHVybiBpbmZsZWN0aW9uLmRhc2hlcml6ZShpbmZsZWN0aW9uLnVuZGVyc2NvcmUoYmFzZU5hbWUpKVxufVxuXG4vKipcbiAqIFJ1bnMgdGhlIGluZmVyQWN0aW9uTmFtZSBoZWxwZXIuXG4gKiBAcGFyYW0ge3R5cGVvZiBWZWxvY2lvdXNNYWlsZXJCYXNlfSBtYWlsZXJDbGFzcyAtIE1haWxlciBjbGFzcy5cbiAqIEBwYXJhbSB7c3RyaW5nfSBzdGFjayAtIEVycm9yIHN0YWNrLlxuICogQHJldHVybnMge3N0cmluZyB8IG51bGx9IC0gSW5mZXJyZWQgYWN0aW9uIG5hbWUuXG4gKi9cbi8vIGZhbGxvdy1pZ25vcmUtbmV4dC1saW5lIGNvbXBsZXhpdHlcbmZ1bmN0aW9uIGluZmVyQWN0aW9uTmFtZShtYWlsZXJDbGFzcywgc3RhY2spIHtcbiAgY29uc3QgcHJvdG90eXBlID0gbWFpbGVyQ2xhc3MucHJvdG90eXBlXG4gIGxldCBhY3Rpb25OYW1lID0gbnVsbFxuXG4gIGZvciAoY29uc3QgbGluZSBvZiBzdGFjay5zcGxpdChcIlxcblwiKSkge1xuICAgIGNvbnN0IG1hdGNoID0gbGluZS5tYXRjaCgvXFxiYXQgKD86YXN5bmMgKT8oPzpuZXcgKT9bXlxccy5dK1xcLihbXlxccy5dKykgLylcblxuICAgIGlmICghbWF0Y2gpIGNvbnRpbnVlXG5cbiAgICBjb25zdCBmcmFtZUFjdGlvbk5hbWUgPSBtYXRjaFsxXVxuXG4gICAgaWYgKGZyYW1lQWN0aW9uTmFtZSA9PT0gXCJtYWlsXCIpIGNvbnRpbnVlXG4gICAgaWYgKGZyYW1lQWN0aW9uTmFtZS5zdGFydHNXaXRoKFwiX1wiKSkgY29udGludWVcbiAgICBpZiAoZnJhbWVBY3Rpb25OYW1lID09PSBcImNvbnN0cnVjdG9yXCIpIGNvbnRpbnVlXG4gICAgaWYgKE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHkuY2FsbChWZWxvY2lvdXNNYWlsZXJCYXNlLnByb3RvdHlwZSwgZnJhbWVBY3Rpb25OYW1lKSkgY29udGludWVcbiAgICBpZiAodHlwZW9mIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqLyAoLyoqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gKi8gKHByb3RvdHlwZSkpW2ZyYW1lQWN0aW9uTmFtZV0gIT09IFwiZnVuY3Rpb25cIikgY29udGludWVcblxuICAgIGFjdGlvbk5hbWUgPSBmcmFtZUFjdGlvbk5hbWVcbiAgfVxuXG4gIHJldHVybiBhY3Rpb25OYW1lXG59XG5cbi8qKlxuICogQmFzZSBtYWlsZXIgd2l0aCB2aWV3IHJlbmRlcmluZyBhbmQgZGVsaXZlcnkgaGVscGVycy5cbiAqL1xuZXhwb3J0IGNsYXNzIFZlbG9jaW91c01haWxlckJhc2Uge1xuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IFthcmdzXSAtIENvbnN0cnVjdG9yIGFyZ3MuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBbYXJncy5jb25maWd1cmF0aW9uXSAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7Y29uZmlndXJhdGlvbn0gPSB7fSkge1xuICAgIHRoaXMuX2FjdGlvbk5hbWUgPSBudWxsXG4gICAgdGhpcy5fbWFpbE9wdGlvbnMgPSBudWxsXG4gICAgdGhpcy5fdmlld1BhcmFtcyA9IHt9XG4gICAgdGhpcy5fY29uZmlndXJhdGlvblByb21pc2UgPSBjb25maWd1cmF0aW9uID8gUHJvbWlzZS5yZXNvbHZlKGNvbmZpZ3VyYXRpb24pIDogY29uZmlndXJhdGlvblJlc29sdmVyKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGFzc2lnbiB2aWV3LlxuICAgKiBAcGFyYW0ge1JlY29yZDxzdHJpbmcsIFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gcGFyYW1zIC0gVmlldyBwYXJhbXMuXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIGFzc2lnblZpZXcocGFyYW1zKSB7XG4gICAgdGhpcy5fdmlld1BhcmFtcyA9IE9iamVjdC5hc3NpZ24odGhpcy5fdmlld1BhcmFtcywgcGFyYW1zIHx8IHt9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgbWFpbC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBNYWlsIG9wdGlvbnMuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGFyZ3MudG8gLSBSZWNpcGllbnQuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLnN1YmplY3QgLSBTdWJqZWN0IGxpbmUuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IFthcmdzLmZyb21dIC0gU2VuZGVyLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBbYXJncy5jY10gLSBDQyByZWNpcGllbnRzLlxuICAgKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBbYXJncy5iY2NdIC0gQkNDIHJlY2lwaWVudHMuXG4gICAqIEBwYXJhbSB7UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IFthcmdzLnJlcGx5VG9dIC0gUmVwbHktdG8gYWRkcmVzcy5cbiAgICogQHBhcmFtIHtSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+fSBbYXJncy5oZWFkZXJzXSAtIEN1c3RvbSBoZWFkZXJzLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gW2FyZ3MuYWN0aW9uTmFtZV0gLSBNYWlsZXIgYWN0aW9uIG5hbWUuXG4gICAqIEBwYXJhbSB7UHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPn0gW2FyZ3MuYWN0aW9uUHJvbWlzZV0gLSBBY3Rpb24gY29tcGxldGlvbiBwcm9taXNlLlxuICAgKiBAcmV0dXJucyB7TWFpbGVyRGVsaXZlcnl9IC0gRGVsaXZlcnkgd3JhcHBlci5cbiAgICovXG4gIG1haWwoe3RvLCBzdWJqZWN0LCBmcm9tLCBjYywgYmNjLCByZXBseVRvLCBoZWFkZXJzLCBhY3Rpb25OYW1lLCBhY3Rpb25Qcm9taXNlLCAuLi5yZXN0QXJnc30pIHtcbiAgICByZXN0QXJnc0Vycm9yKHJlc3RBcmdzKVxuXG4gICAgY29uc3QgcmVzb2x2ZWRBY3Rpb25OYW1lID0gYWN0aW9uTmFtZSB8fCBpbmZlckFjdGlvbk5hbWUoLyoqIEB0eXBlIHt0eXBlb2YgVmVsb2Npb3VzTWFpbGVyQmFzZX0gKi8gKHRoaXMuY29uc3RydWN0b3IpLCBuZXcgRXJyb3IoKS5zdGFjayB8fCBcIlwiKVxuXG4gICAgaWYgKCFyZXNvbHZlZEFjdGlvbk5hbWUpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTWlzc2luZyBhY3Rpb25OYW1lIGZvciAke3RoaXMuY29uc3RydWN0b3IubmFtZX0ubWFpbCgpYClcbiAgICB9XG5cbiAgICB0aGlzLl9hY3Rpb25OYW1lID0gcmVzb2x2ZWRBY3Rpb25OYW1lXG4gICAgdGhpcy5fbWFpbE9wdGlvbnMgPSB7dG8sIHN1YmplY3QsIGZyb20sIGNjLCBiY2MsIHJlcGx5VG8sIGhlYWRlcnN9XG4gICAgY29uc3QgcmVzb2x2ZWRBY3Rpb25Qcm9taXNlID0gYWN0aW9uUHJvbWlzZSA9PT0gdW5kZWZpbmVkID8gUHJvbWlzZS5yZXNvbHZlKCkgOiBQcm9taXNlLnJlc29sdmUoYWN0aW9uUHJvbWlzZSlcblxuICAgIHJldHVybiBuZXcgTWFpbGVyRGVsaXZlcnkoe1xuICAgICAgbWFpbGVyOiB0aGlzLFxuICAgICAgYWN0aW9uUHJvbWlzZTogcmVzb2x2ZWRBY3Rpb25Qcm9taXNlLFxuICAgICAgYWN0aW9uTmFtZTogcmVzb2x2ZWRBY3Rpb25OYW1lXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBjb25maWd1cmF0aW9uLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHQ+fSAtIENvbmZpZ3VyYXRpb24gaW5zdGFuY2UuXG4gICAqL1xuICBhc3luYyBfZ2V0Q29uZmlndXJhdGlvbigpIHtcbiAgICByZXR1cm4gYXdhaXQgdGhpcy5fY29uZmlndXJhdGlvblByb21pc2VcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBhY3Rpb24gbmFtZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBBY3Rpb24gbmFtZS5cbiAgICovXG4gIF9nZXRBY3Rpb25OYW1lKCkge1xuICAgIGlmICghdGhpcy5fYWN0aW9uTmFtZSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBObyBtYWlsZXIgYWN0aW9uIHNldCBvbiAke3RoaXMuY29uc3RydWN0b3IubmFtZX1gKVxuICAgIH1cblxuICAgIHJldHVybiB0aGlzLl9hY3Rpb25OYW1lXG4gIH1cblxuICAvKipcbiAgICogUnVucyBidWlsZCBwYXlsb2FkIHN5bmMuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBodG1sIC0gUmVuZGVyZWQgSFRNTC5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4vaW5kZXguanNcIikuTWFpbGVyRGVsaXZlcnlQYXlsb2FkfSAtIERlbGl2ZXJ5IHBheWxvYWQuXG4gICAqL1xuICBfYnVpbGRQYXlsb2FkU3luYyhodG1sKSB7XG4gICAgY29uc3QgbWFpbE9wdGlvbnMgPSB0aGlzLl9tYWlsT3B0aW9uc1xuXG4gICAgaWYgKCFtYWlsT3B0aW9ucykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBNaXNzaW5nIG1haWwoKSBvcHRpb25zIGZvciAke3RoaXMuY29uc3RydWN0b3IubmFtZX0jJHt0aGlzLl9nZXRBY3Rpb25OYW1lKCl9LiBHb3Q6ICR7U3RyaW5nKG1haWxPcHRpb25zKX1gKVxuICAgIH1cblxuICAgIGlmICghbWFpbE9wdGlvbnMudG8pIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihgTWlzc2luZyBcInRvXCIgZm9yICR7dGhpcy5jb25zdHJ1Y3Rvci5uYW1lfSMke3RoaXMuX2dldEFjdGlvbk5hbWUoKX0uIEdvdDogJHtTdHJpbmcobWFpbE9wdGlvbnMudG8pfWApXG4gICAgfVxuXG4gICAgaWYgKCFtYWlsT3B0aW9ucy5zdWJqZWN0KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYE1pc3NpbmcgXCJzdWJqZWN0XCIgZm9yICR7dGhpcy5jb25zdHJ1Y3Rvci5uYW1lfSMke3RoaXMuX2dldEFjdGlvbk5hbWUoKX0uIEdvdDogJHtTdHJpbmcobWFpbE9wdGlvbnMuc3ViamVjdCl9YClcbiAgICB9XG5cbiAgICByZXR1cm4ge1xuICAgICAgdG86IG1haWxPcHRpb25zLnRvLFxuICAgICAgc3ViamVjdDogbWFpbE9wdGlvbnMuc3ViamVjdCxcbiAgICAgIGZyb206IG1haWxPcHRpb25zLmZyb20sXG4gICAgICBjYzogbWFpbE9wdGlvbnMuY2MsXG4gICAgICBiY2M6IG1haWxPcHRpb25zLmJjYyxcbiAgICAgIHJlcGx5VG86IG1haWxPcHRpb25zLnJlcGx5VG8sXG4gICAgICBoZWFkZXJzOiBtYWlsT3B0aW9ucy5oZWFkZXJzLFxuICAgICAgaHRtbCxcbiAgICAgIG1haWxlcjogdGhpcy5jb25zdHJ1Y3Rvci5uYW1lLFxuICAgICAgYWN0aW9uOiB0aGlzLl9nZXRBY3Rpb25OYW1lKClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBidWlsZCBwYXlsb2FkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL2luZGV4LmpzXCIpLk1haWxlckRlbGl2ZXJ5UGF5bG9hZD59IC0gRGVsaXZlcnkgcGF5bG9hZC5cbiAgICovXG4gIGFzeW5jIF9idWlsZFBheWxvYWQoKSB7XG4gICAgY29uc3QgaHRtbCA9IGF3YWl0IHRoaXMuX3JlbmRlclZpZXcoKVxuXG4gICAgcmV0dXJuIHRoaXMuX2J1aWxkUGF5bG9hZFN5bmMoaHRtbClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHJlbmRlciB2aWV3LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmc+fSAtIFJlbmRlcmVkIEhUTUwuXG4gICAqL1xuICBhc3luYyBfcmVuZGVyVmlldygpIHtcbiAgICBjb25zdCBjb25maWd1cmF0aW9uID0gYXdhaXQgdGhpcy5fZ2V0Q29uZmlndXJhdGlvbigpXG4gICAgY29uc3QgbWFpbGVyRGlyID0gbWFpbGVyRGlyZWN0b3J5TmFtZSh0aGlzLmNvbnN0cnVjdG9yLm5hbWUpXG4gICAgY29uc3QgYWN0aW9uTmFtZSA9IHRoaXMuX2dldEFjdGlvbk5hbWUoKVxuICAgIGNvbnN0IGZpbGVOYW1lID0gdmlld0ZpbGVOYW1lKGFjdGlvbk5hbWUpXG4gICAgY29uc3Qgdmlld1BhdGggPSBgJHtjb25maWd1cmF0aW9uLmdldERpcmVjdG9yeSgpfS9zcmMvbWFpbGVycy8ke21haWxlckRpcn0vJHtmaWxlTmFtZX0uZWpzYFxuICAgIGNvbnN0IHRyYW5zbGF0ZSA9ICgvKiogQHR5cGUge3N0cmluZ30gKi8gbXNnSUQsIC8qKiBAdHlwZSB7UmVjb3JkPHN0cmluZywgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgdW5kZWZpbmVkfSAqLyBhcmdzKSA9PiBjb25maWd1cmF0aW9uLmdldFRyYW5zbGF0b3IoKShtc2dJRCwgYXJncylcbiAgICBjb25zdCB2aWV3UGFyYW1zID0gaW5jb3Jwb3JhdGUoe21haWxlcjogdGhpcywgXzogdHJhbnNsYXRlfSwgdGhpcy5fdmlld1BhcmFtcylcblxuICAgIHJldHVybiBhd2FpdCBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICBlanMucmVuZGVyRmlsZSh2aWV3UGF0aCwgdmlld1BhcmFtcywge30sIChlcnIsIHN0cikgPT4ge1xuICAgICAgICBpZiAoZXJyKSB7XG4gICAgICAgICAgY29uc3QgZXJyb3JDb2RlID0gLyoqIEB0eXBlIHt7Y29kZT86IHN0cmluZ319ICovIChlcnIpLmNvZGVcblxuICAgICAgICAgIGlmIChlcnJvckNvZGUgPT09IFwiRU5PRU5UXCIpIHtcbiAgICAgICAgICAgIHJlamVjdChuZXcgRXJyb3IoYE1pc3NpbmcgbWFpbGVyIHZpZXcgZmlsZTogJHt2aWV3UGF0aH1gKSlcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgcmVqZWN0KGVycilcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgcmVzb2x2ZShzdHIpXG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGRlbGl2ZXIgcGF5bG9hZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2luZGV4LmpzXCIpLk1haWxlckRlbGl2ZXJ5UGF5bG9hZH0gcGF5bG9hZCAtIE1haWwgZGVsaXZlcnkgcGF5bG9hZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi9pbmRleC5qc1wiKS5NYWlsZXJEZWxpdmVyeVBheWxvYWQgfCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gSGFuZGxlciByZXN1bHQuXG4gICAqL1xuICBhc3luYyBfZGVsaXZlclBheWxvYWQocGF5bG9hZCkge1xuICAgIHJldHVybiBhd2FpdCBkZWxpdmVyUGF5bG9hZChwYXlsb2FkKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZW5xdWV1ZSBwYXlsb2FkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vaW5kZXguanNcIikuTWFpbGVyRGVsaXZlcnlQYXlsb2FkfSBwYXlsb2FkIC0gTWFpbCBkZWxpdmVyeSBwYXlsb2FkLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vaW5kZXguanNcIikuTWFpbGVyRGVsaXZlcnlMYXRlck9wdGlvbnN9IFtvcHRpb25zXSAtIERlbGl2ZXJ5IGV4ZWN1dGlvbiBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmcgfCBpbXBvcnQoXCIuL2luZGV4LmpzXCIpLk1haWxlckRlbGl2ZXJ5UGF5bG9hZCB8IG51bGw+fSAtIEpvYiBpZCBvciBwYXlsb2FkIGluIHRlc3QgbW9kZS5cbiAgICovXG4gIGFzeW5jIF9lbnF1ZXVlUGF5bG9hZChwYXlsb2FkLCBvcHRpb25zKSB7XG4gICAgY29uc3QgY29uZmlndXJhdGlvbiA9IGF3YWl0IHRoaXMuX2dldENvbmZpZ3VyYXRpb24oKVxuXG4gICAgcmV0dXJuIGF3YWl0IGVucXVldWVQYXlsb2FkKHBheWxvYWQsIHsuLi5vcHRpb25zLCBjb25maWd1cmF0aW9ufSlcbiAgfVxufVxuXG4vKipcbiAqIFJ1bnMgdGhlIGRlbGl2ZXJpZXMgaGVscGVyLlxuICogQHJldHVybnMge2ltcG9ydChcIi4vaW5kZXguanNcIikuTWFpbGVyRGVsaXZlcnlQYXlsb2FkW119IC0gRGVsaXZlcmVkIHBheWxvYWRzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gZGVsaXZlcmllcygpIHtcbiAgcmV0dXJuIGRlbGl2ZXJpZXNTdG9yZS5zbGljZSgpXG59XG5cbi8qKlxuICogUnVucyB0aGUgY2xlYXJEZWxpdmVyaWVzIGhlbHBlci5cbiAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNsZWFyRGVsaXZlcmllcygpIHtcbiAgZGVsaXZlcmllc1N0b3JlLmxlbmd0aCA9IDBcbn1cblxuLyoqXG4gKiBSdW5zIHRoZSBzZXREZWxpdmVyeUhhbmRsZXIgaGVscGVyLlxuICogQHBhcmFtIHsocGF5bG9hZDogaW1wb3J0KFwiLi9pbmRleC5qc1wiKS5NYWlsZXJEZWxpdmVyeVBheWxvYWQpID0+IFByb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+IHwgUmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT59IGhhbmRsZXIgLSBEZWxpdmVyeSBoYW5kbGVyLlxuICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICovXG5leHBvcnQgZnVuY3Rpb24gc2V0RGVsaXZlcnlIYW5kbGVyKGhhbmRsZXIpIHtcbiAgZGVsaXZlcnlIYW5kbGVyID0gaGFuZGxlclxufVxuXG4vKipcbiAqIFJ1bnMgdGhlIGdldERlbGl2ZXJ5SGFuZGxlciBoZWxwZXIuXG4gKiBAcmV0dXJucyB7KChwYXlsb2FkOiBpbXBvcnQoXCIuL2luZGV4LmpzXCIpLk1haWxlckRlbGl2ZXJ5UGF5bG9hZCkgPT4gUHJvbWlzZTxSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj4gfCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPikgfCBudWxsfSAtIEhhbmRsZXIgb3IgbnVsbC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGdldERlbGl2ZXJ5SGFuZGxlcigpIHtcbiAgcmV0dXJuIGRlbGl2ZXJ5SGFuZGxlclxufVxuXG4vKipcbiAqIFJ1bnMgdGhlIGRlbGl2ZXJQYXlsb2FkIGhlbHBlci5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9pbmRleC5qc1wiKS5NYWlsZXJEZWxpdmVyeVBheWxvYWR9IHBheWxvYWQgLSBNYWlsIGRlbGl2ZXJ5IHBheWxvYWQuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTxpbXBvcnQoXCIuL2luZGV4LmpzXCIpLk1haWxlckRlbGl2ZXJ5UGF5bG9hZCB8IFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gLSBIYW5kbGVyIHJlc3VsdC5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGRlbGl2ZXJQYXlsb2FkKHBheWxvYWQpIHtcbiAgY29uc3QgY29uZmlndXJhdGlvbiA9IGF3YWl0IGNvbmZpZ3VyYXRpb25SZXNvbHZlcigpXG4gIGNvbnN0IGJhY2tlbmQgPSBjb25maWd1cmF0aW9uLmdldE1haWxlckJhY2tlbmQoKVxuICBjb25zdCBkZWxpdmVyeU9wZXJhdGlvbiA9IGRlbGl2ZXJ5T3BlcmF0aW9uRnJvbVBheWxvYWQocGF5bG9hZClcblxuICBpZiAoZGVsaXZlcnlPcGVyYXRpb24pIHtcbiAgICBjb25zdCBjYXBhYmlsaXR5ID0gcmVxdWlyZURlbGl2ZXJ5SWRlbXBvdGVuY3lDYXBhYmlsaXR5KHtiYWNrZW5kLCBkZWxpdmVyeU9wZXJhdGlvbiwgcGF5bG9hZH0pXG4gICAgY29uc3Qgb3BlcmF0aW9uU3RvcmUgPSBuZXcgTWFpbGVyRGVsaXZlcnlPcGVyYXRpb25TdG9yZSh7Y29uZmlndXJhdGlvbn0pXG5cbiAgICBhd2FpdCBvcGVyYXRpb25TdG9yZS5iZWdpbkF0dGVtcHQoe2NhcGFiaWxpdHksIHBheWxvYWR9KVxuICB9XG5cbiAgaWYgKGNvbmZpZ3VyYXRpb24uZ2V0RW52aXJvbm1lbnQoKSA9PT0gXCJ0ZXN0XCIpIHtcbiAgICBkZWxpdmVyaWVzU3RvcmUucHVzaChwYXlsb2FkKVxuICAgIHJldHVybiBwYXlsb2FkXG4gIH1cblxuICBpZiAoYmFja2VuZD8uZGVsaXZlcikge1xuICAgIHJldHVybiBhd2FpdCBiYWNrZW5kLmRlbGl2ZXIoe3BheWxvYWQsIGNvbmZpZ3VyYXRpb259KVxuICB9XG5cbiAgY29uc3QgaGFuZGxlciA9IGRlbGl2ZXJ5SGFuZGxlclxuXG4gIGlmICghaGFuZGxlcikge1xuICAgIHRocm93IG5ldyBFcnJvcihgTm8gbWFpbCBkZWxpdmVyeSBoYW5kbGVyIGNvbmZpZ3VyZWQgZm9yIFwiJHtwYXlsb2FkLnN1YmplY3R9XCIgdG8gXCIke3BheWxvYWQudG99XCJgKVxuICB9XG5cbiAgcmV0dXJuIGF3YWl0IGhhbmRsZXIocGF5bG9hZClcbn1cblxuLyoqXG4gKiBSdW5zIHRoZSBlbnF1ZXVlUGF5bG9hZCBoZWxwZXIuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4vaW5kZXguanNcIikuTWFpbGVyRGVsaXZlcnlQYXlsb2FkfSBwYXlsb2FkIC0gTWFpbCBkZWxpdmVyeSBwYXlsb2FkLlxuICogQHBhcmFtIHtvYmplY3R9IFtvcHRpb25zXSAtIEVucXVldWUgb3B0aW9ucy5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBbb3B0aW9ucy5jb25maWd1cmF0aW9uXSAtIE93bmluZyBjb25maWd1cmF0aW9uLlxuICogQHBhcmFtIHtpbXBvcnQoXCIuL2luZGV4LmpzXCIpLk1haWxlckRlbGl2ZXJ5T3BlcmF0aW9uUmVxdWVzdH0gW29wdGlvbnMuZGVsaXZlcnlPcGVyYXRpb25dIC0gUmVxdWlyZWQgcHJvdmlkZXItYmFja2VkIG9wZXJhdGlvbi5cbiAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZyB8IGltcG9ydChcIi4vaW5kZXguanNcIikuTWFpbGVyRGVsaXZlcnlQYXlsb2FkIHwgbnVsbD59IC0gSm9iIGlkIG9yIHBheWxvYWQgaW4gdGVzdCBtb2RlLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZW5xdWV1ZVBheWxvYWQocGF5bG9hZCwge2NvbmZpZ3VyYXRpb246IHN1cHBsaWVkQ29uZmlndXJhdGlvbiwgZGVsaXZlcnlPcGVyYXRpb259ID0ge30pIHtcbiAgY29uc3QgY29uZmlndXJhdGlvbiA9IHN1cHBsaWVkQ29uZmlndXJhdGlvbiB8fCBhd2FpdCBjb25maWd1cmF0aW9uUmVzb2x2ZXIoKVxuICBsZXQgcGVyc2lzdGVkUGF5bG9hZCA9IHBheWxvYWRcblxuICBpZiAoZGVsaXZlcnlPcGVyYXRpb24pIHtcbiAgICBjb25zdCBiYWNrZW5kID0gY29uZmlndXJhdGlvbi5nZXRNYWlsZXJCYWNrZW5kKClcbiAgICBjb25zdCBvcGVyYXRpb25QYXlsb2FkID0gdHlwZW9mIGJhY2tlbmQ/LnByZXBhcmVEZWxpdmVyeU9wZXJhdGlvblBheWxvYWQgPT09IFwiZnVuY3Rpb25cIlxuICAgICAgPyBiYWNrZW5kLnByZXBhcmVEZWxpdmVyeU9wZXJhdGlvblBheWxvYWQoe3BheWxvYWR9KVxuICAgICAgOiBwYXlsb2FkXG4gICAgY29uc3QgY2FwYWJpbGl0eSA9IHJlcXVpcmVEZWxpdmVyeUlkZW1wb3RlbmN5Q2FwYWJpbGl0eSh7YmFja2VuZCwgZGVsaXZlcnlPcGVyYXRpb24sIHBheWxvYWQ6IG9wZXJhdGlvblBheWxvYWR9KVxuXG4gICAgcGVyc2lzdGVkUGF5bG9hZCA9IHByZXBhcmVSZXF1aXJlZERlbGl2ZXJ5UGF5bG9hZCh7Y2FwYWJpbGl0eSwgZGVsaXZlcnlPcGVyYXRpb24sIHBheWxvYWQ6IG9wZXJhdGlvblBheWxvYWR9KVxuICB9XG5cbiAgaWYgKGNvbmZpZ3VyYXRpb24uZ2V0RW52aXJvbm1lbnQoKSA9PT0gXCJ0ZXN0XCIpIHtcbiAgICBkZWxpdmVyaWVzU3RvcmUucHVzaChwZXJzaXN0ZWRQYXlsb2FkKVxuICAgIHJldHVybiBwZXJzaXN0ZWRQYXlsb2FkXG4gIH1cblxuICBjb25zdCB7ZGVmYXVsdDogbWFpbERlbGl2ZXJ5Sm9ifSA9IGF3YWl0IGltcG9ydChcIi4uL2pvYnMvbWFpbC1kZWxpdmVyeS5qc1wiKVxuICBjb25zdCBjbGllbnQgPSBuZXcgQmFja2dyb3VuZEpvYnNDbGllbnQoe2NvbmZpZ3VyYXRpb259KVxuICBjb25zdCBqb2JPcHRpb25zID0gbWFpbERlbGl2ZXJ5Sm9iLl93aXRoUXVldWUoZGVsaXZlcnlPcGVyYXRpb24gPyB7aWRlbXBvdGVuY3lLZXk6IGRlbGl2ZXJ5T3BlcmF0aW9uLmlkfSA6IHVuZGVmaW5lZClcblxuICByZXR1cm4gYXdhaXQgY2xpZW50LmVucXVldWUoe1xuICAgIGFyZ3M6IFtwZXJzaXN0ZWRQYXlsb2FkXSxcbiAgICBqb2JOYW1lOiBtYWlsRGVsaXZlcnlKb2Iuam9iTmFtZSgpLFxuICAgIG9wdGlvbnM6IGpvYk9wdGlvbnNcbiAgfSlcbn1cbiJdfQ==