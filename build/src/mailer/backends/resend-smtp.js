// @ts-check
import SmtpMailerBackend from "./smtp.js";
import VelociousError from "../../velocious-error.js";
import { deliveryOperationFromPayload } from "../delivery-operation.js";
const PROVIDER_KIND = "resend-smtp";
const RETENTION_MS = 24 * 60 * 60 * 1000;
const IDEMPOTENCY_HEADER = "Resend-Idempotency-Key";
/**
 * Checks whether a value contains an SMTP header control character.
 * @param {string} value - Header value.
 * @returns {boolean} - Whether a control character is present.
 */
function containsHeaderValueControlCharacter(value) {
    for (const character of value) {
        const codePoint = character.charCodeAt(0);
        if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f))
            return true;
    }
    return false;
}
/**
 * Keeps the provider-owned operation header out of caller payloads.
 * @param {import("../index.js").MailerDeliveryPayload} payload - Mail payload.
 * @returns {void}
 */
function rejectReservedHeaderOverride(payload) {
    if (Object.keys(payload.headers || {}).some((name) => name.toLowerCase() === IDEMPOTENCY_HEADER.toLowerCase())) {
        throw VelociousError.safe(`Reserved mail header ${IDEMPOTENCY_HEADER} is owned by ResendSmtpMailerBackend required delivery operations.`, {
            code: "mail-delivery-idempotency-header-reserved"
        });
    }
}
/**
 * Resend SMTP transport with Resend's documented 24-hour idempotency header.
 */
export default class ResendSmtpMailerBackend extends SmtpMailerBackend {
    /**
     * Resolves the SMTP sender before it becomes part of the immutable digest.
     * @param {object} args - Preparation input.
     * @param {import("../index.js").MailerDeliveryPayload} args.payload - Rendered payload.
     * @returns {import("../index.js").MailerDeliveryPayload} - Provider-ready payload.
     */
    prepareDeliveryOperationPayload({ payload }) {
        const from = payload.from || this.defaultFrom;
        if (!from) {
            throw VelociousError.safe("Required Resend mail delivery needs a from address.", {
                code: "mail-delivery-from-missing"
            });
        }
        return { ...payload, from };
    }
    /**
     * Advertises the provider-specific guarantee used by required operations.
     * @returns {import("../index.js").MailerDeliveryIdempotencyCapability} - Capability.
     */
    deliveryIdempotencyCapability() {
        return { providerKind: PROVIDER_KIND, retentionMs: RETENTION_MS };
    }
    /**
     * Validates Resend's documented length and SMTP header-value safety contract.
     * @param {object} args - Validation input.
     * @param {import("../index.js").MailerDeliveryOperationRequest | import("../index.js").MailerDeliveryOperation} args.deliveryOperation - Operation.
     * @param {import("../index.js").MailerDeliveryPayload} args.payload - Rendered or persisted mail payload.
     * @returns {void}
     */
    validateDeliveryOperation({ deliveryOperation, payload }) {
        if (typeof deliveryOperation.id !== "string" ||
            deliveryOperation.id.length < 1 ||
            deliveryOperation.id.length > 256 ||
            containsHeaderValueControlCharacter(deliveryOperation.id)) {
            throw VelociousError.safe("Resend idempotency keys must contain between 1 and 256 characters without control characters.", {
                code: "mail-delivery-idempotency-key-invalid"
            });
        }
        rejectReservedHeaderOverride(payload);
    }
    /**
     * Injects the framework-owned Resend operation header before generic SMTP serialization.
     * @param {object} args - Delivery args.
     * @param {import("../index.js").MailerDeliveryPayload} args.payload - Mail payload.
     * @param {import("../../configuration.js").default} [args.configuration] - Active configuration.
     * @returns {Promise<void>} - Resolves when accepted and shut down.
     */
    async deliver({ payload, configuration }) {
        const headers = payload.headers || {};
        if (payload.deliveryOperation) {
            this.validateDeliveryOperation({ deliveryOperation: payload.deliveryOperation, payload });
        }
        else {
            rejectReservedHeaderOverride(payload);
        }
        const operation = deliveryOperationFromPayload(payload);
        if (!operation) {
            await super.deliver({ payload, configuration });
            return;
        }
        await super.deliver({
            configuration,
            payload: {
                ...payload,
                headers: { ...headers, [IDEMPOTENCY_HEADER]: operation.id }
            }
        });
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVzZW5kLXNtdHAuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvbWFpbGVyL2JhY2tlbmRzL3Jlc2VuZC1zbXRwLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLGlCQUFpQixNQUFNLFdBQVcsQ0FBQTtBQUN6QyxPQUFPLGNBQWMsTUFBTSwwQkFBMEIsQ0FBQTtBQUNyRCxPQUFPLEVBQUMsNEJBQTRCLEVBQUMsTUFBTSwwQkFBMEIsQ0FBQTtBQUVyRSxNQUFNLGFBQWEsR0FBRyxhQUFhLENBQUE7QUFDbkMsTUFBTSxZQUFZLEdBQUcsRUFBRSxHQUFHLEVBQUUsR0FBRyxFQUFFLEdBQUcsSUFBSSxDQUFBO0FBQ3hDLE1BQU0sa0JBQWtCLEdBQUcsd0JBQXdCLENBQUE7QUFFbkQ7Ozs7R0FJRztBQUNILFNBQVMsbUNBQW1DLENBQUMsS0FBSztJQUNoRCxLQUFLLE1BQU0sU0FBUyxJQUFJLEtBQUssRUFBRSxDQUFDO1FBQzlCLE1BQU0sU0FBUyxHQUFHLFNBQVMsQ0FBQyxVQUFVLENBQUMsQ0FBQyxDQUFDLENBQUE7UUFFekMsSUFBSSxTQUFTLElBQUksSUFBSSxJQUFJLENBQUMsU0FBUyxJQUFJLElBQUksSUFBSSxTQUFTLElBQUksSUFBSSxDQUFDO1lBQUUsT0FBTyxJQUFJLENBQUE7SUFDaEYsQ0FBQztJQUVELE9BQU8sS0FBSyxDQUFBO0FBQ2QsQ0FBQztBQUVEOzs7O0dBSUc7QUFDSCxTQUFTLDRCQUE0QixDQUFDLE9BQU87SUFDM0MsSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLE9BQU8sQ0FBQyxPQUFPLElBQUksRUFBRSxDQUFDLENBQUMsSUFBSSxDQUFDLENBQUMsSUFBSSxFQUFFLEVBQUUsQ0FBQyxJQUFJLENBQUMsV0FBVyxFQUFFLEtBQUssa0JBQWtCLENBQUMsV0FBVyxFQUFFLENBQUMsRUFBRSxDQUFDO1FBQy9HLE1BQU0sY0FBYyxDQUFDLElBQUksQ0FBQyx3QkFBd0Isa0JBQWtCLG9FQUFvRSxFQUFFO1lBQ3hJLElBQUksRUFBRSwyQ0FBMkM7U0FDbEQsQ0FBQyxDQUFBO0lBQ0osQ0FBQztBQUNILENBQUM7QUFFRDs7R0FFRztBQUNILE1BQU0sQ0FBQyxPQUFPLE9BQU8sdUJBQXdCLFNBQVEsaUJBQWlCO0lBQ3BFOzs7OztPQUtHO0lBQ0gsK0JBQStCLENBQUMsRUFBQyxPQUFPLEVBQUM7UUFDdkMsTUFBTSxJQUFJLEdBQUcsT0FBTyxDQUFDLElBQUksSUFBSSxJQUFJLENBQUMsV0FBVyxDQUFBO1FBRTdDLElBQUksQ0FBQyxJQUFJLEVBQUUsQ0FBQztZQUNWLE1BQU0sY0FBYyxDQUFDLElBQUksQ0FBQyxxREFBcUQsRUFBRTtnQkFDL0UsSUFBSSxFQUFFLDRCQUE0QjthQUNuQyxDQUFDLENBQUE7UUFDSixDQUFDO1FBRUQsT0FBTyxFQUFDLEdBQUcsT0FBTyxFQUFFLElBQUksRUFBQyxDQUFBO0lBQzNCLENBQUM7SUFFRDs7O09BR0c7SUFDSCw2QkFBNkI7UUFDM0IsT0FBTyxFQUFDLFlBQVksRUFBRSxhQUFhLEVBQUUsV0FBVyxFQUFFLFlBQVksRUFBQyxDQUFBO0lBQ2pFLENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCx5QkFBeUIsQ0FBQyxFQUFDLGlCQUFpQixFQUFFLE9BQU8sRUFBQztRQUNwRCxJQUNFLE9BQU8saUJBQWlCLENBQUMsRUFBRSxLQUFLLFFBQVE7WUFDeEMsaUJBQWlCLENBQUMsRUFBRSxDQUFDLE1BQU0sR0FBRyxDQUFDO1lBQy9CLGlCQUFpQixDQUFDLEVBQUUsQ0FBQyxNQUFNLEdBQUcsR0FBRztZQUNqQyxtQ0FBbUMsQ0FBQyxpQkFBaUIsQ0FBQyxFQUFFLENBQUMsRUFDekQsQ0FBQztZQUNELE1BQU0sY0FBYyxDQUFDLElBQUksQ0FBQywrRkFBK0YsRUFBRTtnQkFDekgsSUFBSSxFQUFFLHVDQUF1QzthQUM5QyxDQUFDLENBQUE7UUFDSixDQUFDO1FBRUQsNEJBQTRCLENBQUMsT0FBTyxDQUFDLENBQUE7SUFDdkMsQ0FBQztJQUVEOzs7Ozs7T0FNRztJQUNILEtBQUssQ0FBQyxPQUFPLENBQUMsRUFBQyxPQUFPLEVBQUUsYUFBYSxFQUFDO1FBQ3BDLE1BQU0sT0FBTyxHQUFHLE9BQU8sQ0FBQyxPQUFPLElBQUksRUFBRSxDQUFBO1FBRXJDLElBQUksT0FBTyxDQUFDLGlCQUFpQixFQUFFLENBQUM7WUFDOUIsSUFBSSxDQUFDLHlCQUF5QixDQUFDLEVBQUMsaUJBQWlCLEVBQUUsT0FBTyxDQUFDLGlCQUFpQixFQUFFLE9BQU8sRUFBQyxDQUFDLENBQUE7UUFDekYsQ0FBQzthQUFNLENBQUM7WUFDTiw0QkFBNEIsQ0FBQyxPQUFPLENBQUMsQ0FBQTtRQUN2QyxDQUFDO1FBQ0QsTUFBTSxTQUFTLEdBQUcsNEJBQTRCLENBQUMsT0FBTyxDQUFDLENBQUE7UUFFdkQsSUFBSSxDQUFDLFNBQVMsRUFBRSxDQUFDO1lBQ2YsTUFBTSxLQUFLLENBQUMsT0FBTyxDQUFDLEVBQUMsT0FBTyxFQUFFLGFBQWEsRUFBQyxDQUFDLENBQUE7WUFDN0MsT0FBTTtRQUNSLENBQUM7UUFFRCxNQUFNLEtBQUssQ0FBQyxPQUFPLENBQUM7WUFDbEIsYUFBYTtZQUNiLE9BQU8sRUFBRTtnQkFDUCxHQUFHLE9BQU87Z0JBQ1YsT0FBTyxFQUFFLEVBQUMsR0FBRyxPQUFPLEVBQUUsQ0FBQyxrQkFBa0IsQ0FBQyxFQUFFLFNBQVMsQ0FBQyxFQUFFLEVBQUM7YUFDMUQ7U0FDRixDQUFDLENBQUE7SUFDSixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IFNtdHBNYWlsZXJCYWNrZW5kIGZyb20gXCIuL3NtdHAuanNcIlxuaW1wb3J0IFZlbG9jaW91c0Vycm9yIGZyb20gXCIuLi8uLi92ZWxvY2lvdXMtZXJyb3IuanNcIlxuaW1wb3J0IHtkZWxpdmVyeU9wZXJhdGlvbkZyb21QYXlsb2FkfSBmcm9tIFwiLi4vZGVsaXZlcnktb3BlcmF0aW9uLmpzXCJcblxuY29uc3QgUFJPVklERVJfS0lORCA9IFwicmVzZW5kLXNtdHBcIlxuY29uc3QgUkVURU5USU9OX01TID0gMjQgKiA2MCAqIDYwICogMTAwMFxuY29uc3QgSURFTVBPVEVOQ1lfSEVBREVSID0gXCJSZXNlbmQtSWRlbXBvdGVuY3ktS2V5XCJcblxuLyoqXG4gKiBDaGVja3Mgd2hldGhlciBhIHZhbHVlIGNvbnRhaW5zIGFuIFNNVFAgaGVhZGVyIGNvbnRyb2wgY2hhcmFjdGVyLlxuICogQHBhcmFtIHtzdHJpbmd9IHZhbHVlIC0gSGVhZGVyIHZhbHVlLlxuICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBhIGNvbnRyb2wgY2hhcmFjdGVyIGlzIHByZXNlbnQuXG4gKi9cbmZ1bmN0aW9uIGNvbnRhaW5zSGVhZGVyVmFsdWVDb250cm9sQ2hhcmFjdGVyKHZhbHVlKSB7XG4gIGZvciAoY29uc3QgY2hhcmFjdGVyIG9mIHZhbHVlKSB7XG4gICAgY29uc3QgY29kZVBvaW50ID0gY2hhcmFjdGVyLmNoYXJDb2RlQXQoMClcblxuICAgIGlmIChjb2RlUG9pbnQgPD0gMHgxZiB8fCAoY29kZVBvaW50ID49IDB4N2YgJiYgY29kZVBvaW50IDw9IDB4OWYpKSByZXR1cm4gdHJ1ZVxuICB9XG5cbiAgcmV0dXJuIGZhbHNlXG59XG5cbi8qKlxuICogS2VlcHMgdGhlIHByb3ZpZGVyLW93bmVkIG9wZXJhdGlvbiBoZWFkZXIgb3V0IG9mIGNhbGxlciBwYXlsb2Fkcy5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vaW5kZXguanNcIikuTWFpbGVyRGVsaXZlcnlQYXlsb2FkfSBwYXlsb2FkIC0gTWFpbCBwYXlsb2FkLlxuICogQHJldHVybnMge3ZvaWR9XG4gKi9cbmZ1bmN0aW9uIHJlamVjdFJlc2VydmVkSGVhZGVyT3ZlcnJpZGUocGF5bG9hZCkge1xuICBpZiAoT2JqZWN0LmtleXMocGF5bG9hZC5oZWFkZXJzIHx8IHt9KS5zb21lKChuYW1lKSA9PiBuYW1lLnRvTG93ZXJDYXNlKCkgPT09IElERU1QT1RFTkNZX0hFQURFUi50b0xvd2VyQ2FzZSgpKSkge1xuICAgIHRocm93IFZlbG9jaW91c0Vycm9yLnNhZmUoYFJlc2VydmVkIG1haWwgaGVhZGVyICR7SURFTVBPVEVOQ1lfSEVBREVSfSBpcyBvd25lZCBieSBSZXNlbmRTbXRwTWFpbGVyQmFja2VuZCByZXF1aXJlZCBkZWxpdmVyeSBvcGVyYXRpb25zLmAsIHtcbiAgICAgIGNvZGU6IFwibWFpbC1kZWxpdmVyeS1pZGVtcG90ZW5jeS1oZWFkZXItcmVzZXJ2ZWRcIlxuICAgIH0pXG4gIH1cbn1cblxuLyoqXG4gKiBSZXNlbmQgU01UUCB0cmFuc3BvcnQgd2l0aCBSZXNlbmQncyBkb2N1bWVudGVkIDI0LWhvdXIgaWRlbXBvdGVuY3kgaGVhZGVyLlxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBSZXNlbmRTbXRwTWFpbGVyQmFja2VuZCBleHRlbmRzIFNtdHBNYWlsZXJCYWNrZW5kIHtcbiAgLyoqXG4gICAqIFJlc29sdmVzIHRoZSBTTVRQIHNlbmRlciBiZWZvcmUgaXQgYmVjb21lcyBwYXJ0IG9mIHRoZSBpbW11dGFibGUgZGlnZXN0LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIFByZXBhcmF0aW9uIGlucHV0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2luZGV4LmpzXCIpLk1haWxlckRlbGl2ZXJ5UGF5bG9hZH0gYXJncy5wYXlsb2FkIC0gUmVuZGVyZWQgcGF5bG9hZC5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2luZGV4LmpzXCIpLk1haWxlckRlbGl2ZXJ5UGF5bG9hZH0gLSBQcm92aWRlci1yZWFkeSBwYXlsb2FkLlxuICAgKi9cbiAgcHJlcGFyZURlbGl2ZXJ5T3BlcmF0aW9uUGF5bG9hZCh7cGF5bG9hZH0pIHtcbiAgICBjb25zdCBmcm9tID0gcGF5bG9hZC5mcm9tIHx8IHRoaXMuZGVmYXVsdEZyb21cblxuICAgIGlmICghZnJvbSkge1xuICAgICAgdGhyb3cgVmVsb2Npb3VzRXJyb3Iuc2FmZShcIlJlcXVpcmVkIFJlc2VuZCBtYWlsIGRlbGl2ZXJ5IG5lZWRzIGEgZnJvbSBhZGRyZXNzLlwiLCB7XG4gICAgICAgIGNvZGU6IFwibWFpbC1kZWxpdmVyeS1mcm9tLW1pc3NpbmdcIlxuICAgICAgfSlcbiAgICB9XG5cbiAgICByZXR1cm4gey4uLnBheWxvYWQsIGZyb219XG4gIH1cblxuICAvKipcbiAgICogQWR2ZXJ0aXNlcyB0aGUgcHJvdmlkZXItc3BlY2lmaWMgZ3VhcmFudGVlIHVzZWQgYnkgcmVxdWlyZWQgb3BlcmF0aW9ucy5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2luZGV4LmpzXCIpLk1haWxlckRlbGl2ZXJ5SWRlbXBvdGVuY3lDYXBhYmlsaXR5fSAtIENhcGFiaWxpdHkuXG4gICAqL1xuICBkZWxpdmVyeUlkZW1wb3RlbmN5Q2FwYWJpbGl0eSgpIHtcbiAgICByZXR1cm4ge3Byb3ZpZGVyS2luZDogUFJPVklERVJfS0lORCwgcmV0ZW50aW9uTXM6IFJFVEVOVElPTl9NU31cbiAgfVxuXG4gIC8qKlxuICAgKiBWYWxpZGF0ZXMgUmVzZW5kJ3MgZG9jdW1lbnRlZCBsZW5ndGggYW5kIFNNVFAgaGVhZGVyLXZhbHVlIHNhZmV0eSBjb250cmFjdC5cbiAgICogQHBhcmFtIHtvYmplY3R9IGFyZ3MgLSBWYWxpZGF0aW9uIGlucHV0LlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2luZGV4LmpzXCIpLk1haWxlckRlbGl2ZXJ5T3BlcmF0aW9uUmVxdWVzdCB8IGltcG9ydChcIi4uL2luZGV4LmpzXCIpLk1haWxlckRlbGl2ZXJ5T3BlcmF0aW9ufSBhcmdzLmRlbGl2ZXJ5T3BlcmF0aW9uIC0gT3BlcmF0aW9uLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL2luZGV4LmpzXCIpLk1haWxlckRlbGl2ZXJ5UGF5bG9hZH0gYXJncy5wYXlsb2FkIC0gUmVuZGVyZWQgb3IgcGVyc2lzdGVkIG1haWwgcGF5bG9hZC5cbiAgICogQHJldHVybnMge3ZvaWR9XG4gICAqL1xuICB2YWxpZGF0ZURlbGl2ZXJ5T3BlcmF0aW9uKHtkZWxpdmVyeU9wZXJhdGlvbiwgcGF5bG9hZH0pIHtcbiAgICBpZiAoXG4gICAgICB0eXBlb2YgZGVsaXZlcnlPcGVyYXRpb24uaWQgIT09IFwic3RyaW5nXCIgfHxcbiAgICAgIGRlbGl2ZXJ5T3BlcmF0aW9uLmlkLmxlbmd0aCA8IDEgfHxcbiAgICAgIGRlbGl2ZXJ5T3BlcmF0aW9uLmlkLmxlbmd0aCA+IDI1NiB8fFxuICAgICAgY29udGFpbnNIZWFkZXJWYWx1ZUNvbnRyb2xDaGFyYWN0ZXIoZGVsaXZlcnlPcGVyYXRpb24uaWQpXG4gICAgKSB7XG4gICAgICB0aHJvdyBWZWxvY2lvdXNFcnJvci5zYWZlKFwiUmVzZW5kIGlkZW1wb3RlbmN5IGtleXMgbXVzdCBjb250YWluIGJldHdlZW4gMSBhbmQgMjU2IGNoYXJhY3RlcnMgd2l0aG91dCBjb250cm9sIGNoYXJhY3RlcnMuXCIsIHtcbiAgICAgICAgY29kZTogXCJtYWlsLWRlbGl2ZXJ5LWlkZW1wb3RlbmN5LWtleS1pbnZhbGlkXCJcbiAgICAgIH0pXG4gICAgfVxuXG4gICAgcmVqZWN0UmVzZXJ2ZWRIZWFkZXJPdmVycmlkZShwYXlsb2FkKVxuICB9XG5cbiAgLyoqXG4gICAqIEluamVjdHMgdGhlIGZyYW1ld29yay1vd25lZCBSZXNlbmQgb3BlcmF0aW9uIGhlYWRlciBiZWZvcmUgZ2VuZXJpYyBTTVRQIHNlcmlhbGl6YXRpb24uXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gRGVsaXZlcnkgYXJncy5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9pbmRleC5qc1wiKS5NYWlsZXJEZWxpdmVyeVBheWxvYWR9IGFyZ3MucGF5bG9hZCAtIE1haWwgcGF5bG9hZC5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi8uLi9jb25maWd1cmF0aW9uLmpzXCIpLmRlZmF1bHR9IFthcmdzLmNvbmZpZ3VyYXRpb25dIC0gQWN0aXZlIGNvbmZpZ3VyYXRpb24uXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gYWNjZXB0ZWQgYW5kIHNodXQgZG93bi5cbiAgICovXG4gIGFzeW5jIGRlbGl2ZXIoe3BheWxvYWQsIGNvbmZpZ3VyYXRpb259KSB7XG4gICAgY29uc3QgaGVhZGVycyA9IHBheWxvYWQuaGVhZGVycyB8fCB7fVxuXG4gICAgaWYgKHBheWxvYWQuZGVsaXZlcnlPcGVyYXRpb24pIHtcbiAgICAgIHRoaXMudmFsaWRhdGVEZWxpdmVyeU9wZXJhdGlvbih7ZGVsaXZlcnlPcGVyYXRpb246IHBheWxvYWQuZGVsaXZlcnlPcGVyYXRpb24sIHBheWxvYWR9KVxuICAgIH0gZWxzZSB7XG4gICAgICByZWplY3RSZXNlcnZlZEhlYWRlck92ZXJyaWRlKHBheWxvYWQpXG4gICAgfVxuICAgIGNvbnN0IG9wZXJhdGlvbiA9IGRlbGl2ZXJ5T3BlcmF0aW9uRnJvbVBheWxvYWQocGF5bG9hZClcblxuICAgIGlmICghb3BlcmF0aW9uKSB7XG4gICAgICBhd2FpdCBzdXBlci5kZWxpdmVyKHtwYXlsb2FkLCBjb25maWd1cmF0aW9ufSlcbiAgICAgIHJldHVyblxuICAgIH1cblxuICAgIGF3YWl0IHN1cGVyLmRlbGl2ZXIoe1xuICAgICAgY29uZmlndXJhdGlvbixcbiAgICAgIHBheWxvYWQ6IHtcbiAgICAgICAgLi4ucGF5bG9hZCxcbiAgICAgICAgaGVhZGVyczogey4uLmhlYWRlcnMsIFtJREVNUE9URU5DWV9IRUFERVJdOiBvcGVyYXRpb24uaWR9XG4gICAgICB9XG4gICAgfSlcbiAgfVxufVxuIl19