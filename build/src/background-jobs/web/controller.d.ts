import Controller from "../../controller.js";
import BackgroundJobsStore from "../store.js";
/**
 * Read-only HTTP API backing the background-jobs dashboard. Mounted by
 * {@link import("./index.js").default} as a route-resolver hook so it can ship
 * inside the velocious package. Every action is gated by {@link authorizeJobsRequest}.
 */
export default class VelociousBackgroundJobsWebController extends Controller {
    _jobsStore: BackgroundJobsStore | undefined;
    /**
     * Runs mount options.
     * @returns {import("./registry.js").JobsMountOptions} - Options for the mount that matched this request.
     */
    _mountOptions(): import("./registry.js").JobsMountOptions;
    /**
     * Runs store.
     * @returns {BackgroundJobsStore} - Jobs store scoped to the mount's database.
     */
    _store(): BackgroundJobsStore;
    /**
     * Adds CORS headers when the request origin is allowed, so the standalone
     * browser dashboard can read the API cross-origin.
     * @param {import("./registry.js").JobsMountOptions} options - Mount options.
     * @returns {void} - No return value.
     */
    _applyCorsHeaders(options: import("./registry.js").JobsMountOptions): void;
    /**
     * Applies CORS headers, authorizes the request, and runs the action body only
     * when authorized. Renders a 401 otherwise. The base controller has no
     * before-action halting, so authorization is enforced here per action.
     * @param {() => Promise<void>} actionFn - Action body.
     * @returns {Promise<void>} - Resolves when complete.
     */
    _respond(actionFn: () => Promise<void>): Promise<void>;
    /**
     * Runs health.
     * @returns {Promise<void>} - Resolves when complete.
     */
    health(): Promise<void>;
    /**
     * Runs stats.
     * @returns {Promise<void>} - Resolves when complete.
     */
    stats(): Promise<void>;
    /**
     * Runs index.
     * @returns {Promise<void>} - Resolves when complete.
     */
    index(): Promise<void>;
    /**
     * Runs show.
     * @returns {Promise<void>} - Resolves when complete.
     */
    show(): Promise<void>;
    /**
     * Runs schedule.
     * @returns {Promise<void>} - Resolves when complete.
     */
    schedule(): Promise<void>;
    /**
     * Runs serialize job.
     * @param {import("../types.js").BackgroundJobRow} job - Job row.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Serialized job for the API.
     */
    _serializeJob(job: import("../types.js").BackgroundJobRow): Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * Runs serialize schedule.
     * @param {import("../../configuration-types.js").ScheduledBackgroundJobsConfiguration | undefined} scheduled - Scheduled jobs config.
     * @returns {Array<Record<string, ReturnType<typeof JSON.parse>>>} - Serialized recurring jobs.
     */
    _serializeSchedule(scheduled: import("../../configuration-types.js").ScheduledBackgroundJobsConfiguration | undefined): Array<Record<string, ReturnType<typeof JSON.parse>>>;
    /**
     * Runs sanitize status.
     * @param {ReturnType<typeof JSON.parse>} value - Raw status param.
     * @returns {string | undefined} - Valid status or undefined.
     */
    _sanitizeStatus(value: ReturnType<typeof JSON.parse>): string | undefined;
    /**
     * Runs sanitize sort.
     * @param {ReturnType<typeof JSON.parse>} value - Raw sort param (e.g. "createdAtMs" or "-failedAtMs").
     * @returns {{sortColumn: string, sortDirection: "ASC" | "DESC"}} - Normalized sort.
     */
    _sanitizeSort(value: ReturnType<typeof JSON.parse>): {
        sortColumn: string;
        sortDirection: "ASC" | "DESC";
    };
    /**
     * Runs positive int.
     * @param {ReturnType<typeof JSON.parse>} value - Raw numeric param.
     * @param {number} fallback - Fallback when invalid.
     * @returns {number} - Positive integer.
     */
    _positiveInt(value: ReturnType<typeof JSON.parse>, fallback: number): number;
}
//# sourceMappingURL=controller.d.ts.map