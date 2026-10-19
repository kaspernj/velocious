import DatabaseRecord from "../database/record/index.js";
export default class BackgroundJobRecord extends DatabaseRecord {
    static tableName(): string;
    static primaryKey(): string;
    /**
     * Evaluates whether the process that accepted this job is still alive.
     *
     * Local ownership is answered from the recorded runner hostname and OS pid.
     * Jobs accepted on another host, or jobs recorded before runner hostnames
     * existed, answer `unknown`: remote liveness needs a heartbeat or instance
     * registry, which this helper deliberately does not invent.
     * @param {object} [args] - Options.
     * @param {string} [args.hostname] - Hostname to compare against, defaults to this process's hostname.
     * @param {(pid: number) => boolean} [args.probe] - Process probe, injectable for tests.
     * @returns {import("./owner-liveness.js").BackgroundJobOwnerLivenessResult} - Liveness verdict.
     */
    ownerIsAlive({ hostname, probe }?: {
        hostname?: string;
        probe?: (pid: number) => boolean;
    }): import("./owner-liveness.js").BackgroundJobOwnerLivenessResult;
}
//# sourceMappingURL=job-record.d.ts.map