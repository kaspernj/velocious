// @ts-check
import VelociousJob from "../background-jobs/job.js";
import { deliverPayload } from "../mailer.js";
/**
 * Background job for delivering mailer payloads.
 * @augments {VelociousJob<[import("../mailer.js").MailerDeliveryPayload]>}
 */
export default class MailDeliveryJob extends VelociousJob {
    /**
     * Runs perform.
     * @param {import("../mailer.js").MailerDeliveryPayload} payload - Mail delivery payload.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async perform(payload) {
        await deliverPayload(payload);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWFpbC1kZWxpdmVyeS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9qb2JzL21haWwtZGVsaXZlcnkuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sWUFBWSxNQUFNLDJCQUEyQixDQUFBO0FBQ3BELE9BQU8sRUFBQyxjQUFjLEVBQUMsTUFBTSxjQUFjLENBQUE7QUFFM0M7OztHQUdHO0FBQ0gsTUFBTSxDQUFDLE9BQU8sT0FBTyxlQUFnQixTQUFRLFlBQVk7SUFDdkQ7Ozs7T0FJRztJQUNILEtBQUssQ0FBQyxPQUFPLENBQUMsT0FBTztRQUNuQixNQUFNLGNBQWMsQ0FBQyxPQUFPLENBQUMsQ0FBQTtJQUMvQixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IFZlbG9jaW91c0pvYiBmcm9tIFwiLi4vYmFja2dyb3VuZC1qb2JzL2pvYi5qc1wiXG5pbXBvcnQge2RlbGl2ZXJQYXlsb2FkfSBmcm9tIFwiLi4vbWFpbGVyLmpzXCJcblxuLyoqXG4gKiBCYWNrZ3JvdW5kIGpvYiBmb3IgZGVsaXZlcmluZyBtYWlsZXIgcGF5bG9hZHMuXG4gKiBAYXVnbWVudHMge1ZlbG9jaW91c0pvYjxbaW1wb3J0KFwiLi4vbWFpbGVyLmpzXCIpLk1haWxlckRlbGl2ZXJ5UGF5bG9hZF0+fVxuICovXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBNYWlsRGVsaXZlcnlKb2IgZXh0ZW5kcyBWZWxvY2lvdXNKb2Ige1xuICAvKipcbiAgICogUnVucyBwZXJmb3JtLlxuICAgKiBAcGFyYW0ge2ltcG9ydChcIi4uL21haWxlci5qc1wiKS5NYWlsZXJEZWxpdmVyeVBheWxvYWR9IHBheWxvYWQgLSBNYWlsIGRlbGl2ZXJ5IHBheWxvYWQuXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fSAtIFJlc29sdmVzIHdoZW4gY29tcGxldGUuXG4gICAqL1xuICBhc3luYyBwZXJmb3JtKHBheWxvYWQpIHtcbiAgICBhd2FpdCBkZWxpdmVyUGF5bG9hZChwYXlsb2FkKVxuICB9XG59XG4iXX0=