// @ts-check
import restArgsError from "../utils/rest-args-error.js";
/**
 * Represents a prepared mail delivery.
 */
export default class MailerDelivery {
    /**
     * Narrows the runtime value to the documented type.
     * @type {import("./base.js").VelociousMailerBase} */
    mailer;
    /**
     * Narrows the runtime value to the documented type.
     * @type {Promise<ReturnType<typeof JSON.parse>>} */
    actionPromise;
    /**
     * Narrows the runtime value to the documented type.
     * @type {string} */
    actionName;
    /**
     * Runs constructor.
     * @param {object} args - Constructor args.
     * @param {import("./base.js").VelociousMailerBase} args.mailer - Mailer instance.
     * @param {Promise<ReturnType<typeof JSON.parse>>} args.actionPromise - Action promise.
     * @param {string} args.actionName - Action name.
     */
    constructor({ mailer, actionPromise, actionName }) {
        this.mailer = mailer;
        this.actionPromise = actionPromise;
        this.actionName = actionName;
    }
    /**
     * Runs build payload.
     * @returns {Promise<import("./index.js").MailerDeliveryPayload>} - Rendered mailer payload.
     */
    async buildPayload() {
        await this.actionPromise;
        return /** @type {import("./index.js").MailerDeliveryPayload} */ (await this.mailer._buildPayload());
    }
    /**
     * Runs deliver now.
     * @returns {Promise<import("./index.js").MailerDeliveryPayload | ReturnType<typeof JSON.parse>>} - Delivered payload or handler result.
     */
    async deliverNow() {
        const payload = await this.buildPayload();
        return await this.mailer._deliverPayload(payload);
    }
    /**
     * Runs deliver later.
     * @param {import("./index.js").MailerDeliveryLaterOptions} [options] - Delivery execution options.
     * @returns {Promise<string | import("./index.js").MailerDeliveryPayload | null>} - Job id or payload in test mode.
     */
    async deliverLater({ deliveryOperation, ...restArgs } = {}) {
        restArgsError(restArgs);
        const payload = await this.buildPayload();
        return await this.mailer._enqueuePayload(payload, { deliveryOperation });
    }
    /**
     * Runs deliver laver.
     * @param {import("./index.js").MailerDeliveryLaterOptions} [options] - Delivery execution options.
     * @returns {Promise<string | import("./index.js").MailerDeliveryPayload | null>} - Job id or payload in test mode.
     */
    async deliverLaver(options) {
        return await this.deliverLater(options);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGVsaXZlcnkuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvbWFpbGVyL2RlbGl2ZXJ5LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLGFBQWEsTUFBTSw2QkFBNkIsQ0FBQTtBQUV2RDs7R0FFRztBQUNILE1BQU0sQ0FBQyxPQUFPLE9BQU8sY0FBYztJQUNqQzs7eURBRXFEO0lBQ3JELE1BQU0sQ0FBQTtJQUNOOzt3REFFb0Q7SUFDcEQsYUFBYSxDQUFBO0lBQ2I7O3dCQUVvQjtJQUNwQixVQUFVLENBQUE7SUFFVjs7Ozs7O09BTUc7SUFDSCxZQUFZLEVBQUMsTUFBTSxFQUFFLGFBQWEsRUFBRSxVQUFVLEVBQUM7UUFDN0MsSUFBSSxDQUFDLE1BQU0sR0FBRyxNQUFNLENBQUE7UUFDcEIsSUFBSSxDQUFDLGFBQWEsR0FBRyxhQUFhLENBQUE7UUFDbEMsSUFBSSxDQUFDLFVBQVUsR0FBRyxVQUFVLENBQUE7SUFDOUIsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyxZQUFZO1FBQ2hCLE1BQU0sSUFBSSxDQUFDLGFBQWEsQ0FBQTtRQUV4QixPQUFPLHlEQUF5RCxDQUFDLENBQUMsTUFBTSxJQUFJLENBQUMsTUFBTSxDQUFDLGFBQWEsRUFBRSxDQUFDLENBQUE7SUFDdEcsQ0FBQztJQUVEOzs7T0FHRztJQUNILEtBQUssQ0FBQyxVQUFVO1FBQ2QsTUFBTSxPQUFPLEdBQUcsTUFBTSxJQUFJLENBQUMsWUFBWSxFQUFFLENBQUE7UUFFekMsT0FBTyxNQUFNLElBQUksQ0FBQyxNQUFNLENBQUMsZUFBZSxDQUFDLE9BQU8sQ0FBQyxDQUFBO0lBQ25ELENBQUM7SUFFRDs7OztPQUlHO0lBQ0gsS0FBSyxDQUFDLFlBQVksQ0FBQyxFQUFDLGlCQUFpQixFQUFFLEdBQUcsUUFBUSxFQUFDLEdBQUcsRUFBRTtRQUN0RCxhQUFhLENBQUMsUUFBUSxDQUFDLENBQUE7UUFDdkIsTUFBTSxPQUFPLEdBQUcsTUFBTSxJQUFJLENBQUMsWUFBWSxFQUFFLENBQUE7UUFFekMsT0FBTyxNQUFNLElBQUksQ0FBQyxNQUFNLENBQUMsZUFBZSxDQUFDLE9BQU8sRUFBRSxFQUFDLGlCQUFpQixFQUFDLENBQUMsQ0FBQTtJQUN4RSxDQUFDO0lBRUQ7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyxZQUFZLENBQUMsT0FBTztRQUN4QixPQUFPLE1BQU0sSUFBSSxDQUFDLFlBQVksQ0FBQyxPQUFPLENBQUMsQ0FBQTtJQUN6QyxDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHJlc3RBcmdzRXJyb3IgZnJvbSBcIi4uL3V0aWxzL3Jlc3QtYXJncy1lcnJvci5qc1wiXG5cbi8qKlxuICogUmVwcmVzZW50cyBhIHByZXBhcmVkIG1haWwgZGVsaXZlcnkuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIE1haWxlckRlbGl2ZXJ5IHtcbiAgLyoqXG4gICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICogQHR5cGUge2ltcG9ydChcIi4vYmFzZS5qc1wiKS5WZWxvY2lvdXNNYWlsZXJCYXNlfSAqL1xuICBtYWlsZXJcbiAgLyoqXG4gICAqIE5hcnJvd3MgdGhlIHJ1bnRpbWUgdmFsdWUgdG8gdGhlIGRvY3VtZW50ZWQgdHlwZS5cbiAgICogQHR5cGUge1Byb21pc2U8UmV0dXJuVHlwZTx0eXBlb2YgSlNPTi5wYXJzZT4+fSAqL1xuICBhY3Rpb25Qcm9taXNlXG4gIC8qKlxuICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAqIEB0eXBlIHtzdHJpbmd9ICovXG4gIGFjdGlvbk5hbWVcblxuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBDb25zdHJ1Y3RvciBhcmdzLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vYmFzZS5qc1wiKS5WZWxvY2lvdXNNYWlsZXJCYXNlfSBhcmdzLm1haWxlciAtIE1haWxlciBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtQcm9taXNlPFJldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+Pn0gYXJncy5hY3Rpb25Qcm9taXNlIC0gQWN0aW9uIHByb21pc2UuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmFjdGlvbk5hbWUgLSBBY3Rpb24gbmFtZS5cbiAgICovXG4gIGNvbnN0cnVjdG9yKHttYWlsZXIsIGFjdGlvblByb21pc2UsIGFjdGlvbk5hbWV9KSB7XG4gICAgdGhpcy5tYWlsZXIgPSBtYWlsZXJcbiAgICB0aGlzLmFjdGlvblByb21pc2UgPSBhY3Rpb25Qcm9taXNlXG4gICAgdGhpcy5hY3Rpb25OYW1lID0gYWN0aW9uTmFtZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgYnVpbGQgcGF5bG9hZC5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi9pbmRleC5qc1wiKS5NYWlsZXJEZWxpdmVyeVBheWxvYWQ+fSAtIFJlbmRlcmVkIG1haWxlciBwYXlsb2FkLlxuICAgKi9cbiAgYXN5bmMgYnVpbGRQYXlsb2FkKCkge1xuICAgIGF3YWl0IHRoaXMuYWN0aW9uUHJvbWlzZVxuXG4gICAgcmV0dXJuIC8qKiBAdHlwZSB7aW1wb3J0KFwiLi9pbmRleC5qc1wiKS5NYWlsZXJEZWxpdmVyeVBheWxvYWR9ICovIChhd2FpdCB0aGlzLm1haWxlci5fYnVpbGRQYXlsb2FkKCkpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZWxpdmVyIG5vdy5cbiAgICogQHJldHVybnMge1Byb21pc2U8aW1wb3J0KFwiLi9pbmRleC5qc1wiKS5NYWlsZXJEZWxpdmVyeVBheWxvYWQgfCBSZXR1cm5UeXBlPHR5cGVvZiBKU09OLnBhcnNlPj59IC0gRGVsaXZlcmVkIHBheWxvYWQgb3IgaGFuZGxlciByZXN1bHQuXG4gICAqL1xuICBhc3luYyBkZWxpdmVyTm93KCkge1xuICAgIGNvbnN0IHBheWxvYWQgPSBhd2FpdCB0aGlzLmJ1aWxkUGF5bG9hZCgpXG5cbiAgICByZXR1cm4gYXdhaXQgdGhpcy5tYWlsZXIuX2RlbGl2ZXJQYXlsb2FkKHBheWxvYWQpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBkZWxpdmVyIGxhdGVyLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4vaW5kZXguanNcIikuTWFpbGVyRGVsaXZlcnlMYXRlck9wdGlvbnN9IFtvcHRpb25zXSAtIERlbGl2ZXJ5IGV4ZWN1dGlvbiBvcHRpb25zLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmcgfCBpbXBvcnQoXCIuL2luZGV4LmpzXCIpLk1haWxlckRlbGl2ZXJ5UGF5bG9hZCB8IG51bGw+fSAtIEpvYiBpZCBvciBwYXlsb2FkIGluIHRlc3QgbW9kZS5cbiAgICovXG4gIGFzeW5jIGRlbGl2ZXJMYXRlcih7ZGVsaXZlcnlPcGVyYXRpb24sIC4uLnJlc3RBcmdzfSA9IHt9KSB7XG4gICAgcmVzdEFyZ3NFcnJvcihyZXN0QXJncylcbiAgICBjb25zdCBwYXlsb2FkID0gYXdhaXQgdGhpcy5idWlsZFBheWxvYWQoKVxuXG4gICAgcmV0dXJuIGF3YWl0IHRoaXMubWFpbGVyLl9lbnF1ZXVlUGF5bG9hZChwYXlsb2FkLCB7ZGVsaXZlcnlPcGVyYXRpb259KVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZGVsaXZlciBsYXZlci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuL2luZGV4LmpzXCIpLk1haWxlckRlbGl2ZXJ5TGF0ZXJPcHRpb25zfSBbb3B0aW9uc10gLSBEZWxpdmVyeSBleGVjdXRpb24gb3B0aW9ucy5cbiAgICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nIHwgaW1wb3J0KFwiLi9pbmRleC5qc1wiKS5NYWlsZXJEZWxpdmVyeVBheWxvYWQgfCBudWxsPn0gLSBKb2IgaWQgb3IgcGF5bG9hZCBpbiB0ZXN0IG1vZGUuXG4gICAqL1xuICBhc3luYyBkZWxpdmVyTGF2ZXIob3B0aW9ucykge1xuICAgIHJldHVybiBhd2FpdCB0aGlzLmRlbGl2ZXJMYXRlcihvcHRpb25zKVxuICB9XG59XG4iXX0=