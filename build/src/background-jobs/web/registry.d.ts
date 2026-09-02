export type JobsMountOptions = {
    /**
     * - Authorization callback. Return true to allow the request.
     */
    authorize?: (args: {
        request: import("../../http-server/client/request.js").default | import("../../http-server/client/websocket-request.js").default;
        ability: (import("../../authorization/ability.js").default | undefined);
        token: (string | null);
        configuration: import("../../configuration.js").default;
    }) => (boolean | void | Promise<boolean | void>);
    /**
     * - Bearer tokens accepted for cross-origin/native access.
     */
    accessTokens?: string[];
    /**
     * - Origins allowed for cross-origin browser access.
     */
    allowedOrigins?: string[];
    /**
     * - When true, job arguments are omitted from API responses.
     */
    redactArgs?: boolean;
    /**
     * - Database identifier the jobs store reads from.
     */
    databaseIdentifier?: string;
};
/**
 * Runs the registerJobsMount helper.
 * @param {import("../../configuration.js").default} configuration - Configuration instance.
 * @param {string} at - Normalized mount path.
 * @param {JobsMountOptions} options - Mount options.
 * @returns {void} - No return value.
 */
export declare function registerJobsMount(configuration: import("../../configuration.js").default, at: string, options: JobsMountOptions): void;
/**
 * Runs the getJobsMount helper.
 * @param {import("../../configuration.js").default} configuration - Configuration instance.
 * @param {string} at - Normalized mount path.
 * @returns {JobsMountOptions | undefined} - Mount options if registered.
 */
export declare function getJobsMount(configuration: import("../../configuration.js").default, at: string): JobsMountOptions | undefined;
//# sourceMappingURL=registry.d.ts.map