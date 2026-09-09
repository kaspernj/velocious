import BaseCommand from "../../../../cli/base-command.js";
export type BackgroundJobsWorkerSignalProcess = {
    /**
     * - Registers one signal listener.
     */
    once: (event: "SIGINT" | "SIGTERM", listener: () => void) => BackgroundJobsWorkerSignalProcess;
    /**
     * - Removes one signal listener.
     */
    removeListener: (event: "SIGINT" | "SIGTERM", listener: () => void) => BackgroundJobsWorkerSignalProcess;
};
/**
 * @typedef {object} BackgroundJobsWorkerSignalProcess
 * @property {(event: "SIGINT" | "SIGTERM", listener: () => void) => BackgroundJobsWorkerSignalProcess} once - Registers one signal listener.
 * @property {(event: "SIGINT" | "SIGTERM", listener: () => void) => BackgroundJobsWorkerSignalProcess} removeListener - Removes one signal listener.
 */
/**
 * Owns process signals before publishing worker readiness.
 * @param {object} args - Shutdown ownership.
 * @param {() => void} args.onReady - Publishes readiness after listeners exist.
 * @param {BackgroundJobsWorkerSignalProcess} [args.processObject] - Signal emitter.
 * @param {number} [args.timeoutMs] - Optional worker drain timeout.
 * @param {{start: () => Promise<void>, stop: (args?: {timeoutMs?: number}) => Promise<void>, waitUntilStopped: () => Promise<void>}} args.worker - Worker lifecycle owner.
 * @returns {Promise<void>} - Resolves once the worker stops.
 */
export declare function waitForBackgroundJobsWorkerShutdown({ onReady, processObject, timeoutMs, worker }: {
    onReady: () => void;
    processObject?: BackgroundJobsWorkerSignalProcess;
    timeoutMs?: number;
    worker: {
        start: () => Promise<void>;
        stop: (args?: {
            timeoutMs?: number;
        }) => Promise<void>;
        waitUntilStopped: () => Promise<void>;
    };
}): Promise<void>;
export default class BackgroundJobsWorkerCommand extends BaseCommand {
    execute(): Promise<void>;
}
//# sourceMappingURL=background-jobs-worker.d.ts.map