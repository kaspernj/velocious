export declare const MAX_LIFECYCLE_REQUEST_TIMEOUT_MS = 120000;
/** One-request acknowledged lifecycle client. */
export default class BackgroundJobsLifecycleClient {
    generationId: string;
    socketPath: string;
    requestTimeoutMs: number;
    /**
     * Creates a lifecycle client.
     * @param {object} args - Client options.
     * @param {import("../configuration.js").default} args.configuration - Configuration.
     * @param {string} [args.generationId] - Explicit generation identity.
     * @param {string} [args.socketPath] - Explicit control socket path.
     * @param {number} [args.requestTimeoutMs] - Request deadline below the supervisor hook timeout (default: 10000).
     */
    constructor({ configuration, generationId, socketPath, requestTimeoutMs }: {
        configuration: import("../configuration.js").default;
        generationId?: string;
        socketPath?: string;
        requestTimeoutMs?: number;
    });
    /**
     * Activates the generation.
     * @returns {Promise<import("./types.js").BackgroundJobsGenerationLifecycleState>} - Resulting state.
     */
    activate(): Promise<import("./types.js").BackgroundJobsGenerationLifecycleState>;
    /**
     * Retires the generation.
     * @returns {Promise<import("./types.js").BackgroundJobsGenerationLifecycleState>} - Resulting state.
     */
    retire(): Promise<import("./types.js").BackgroundJobsGenerationLifecycleState>;
    /**
     * Sends exactly one lifecycle request.
     * @param {"activate" | "retire"} action - Lifecycle action.
     * @returns {Promise<import("./types.js").BackgroundJobsGenerationLifecycleState>} - Resulting state.
     */
    _request(action: "activate" | "retire"): Promise<import("./types.js").BackgroundJobsGenerationLifecycleState>;
    /**
     * Sends the lifecycle request under its caller-owned deadline.
     * @param {object} args - Request details.
     * @param {"activate" | "retire"} args.action - Lifecycle action.
     * @param {AbortSignal} args.signal - Request deadline signal.
     * @returns {Promise<import("./types.js").BackgroundJobsGenerationLifecycleState>} - Resulting state.
     */
    _runRequest({ action, signal }: {
        action: "activate" | "retire";
        signal: AbortSignal;
    }): Promise<import("./types.js").BackgroundJobsGenerationLifecycleState>;
}
//# sourceMappingURL=lifecycle-client.d.ts.map