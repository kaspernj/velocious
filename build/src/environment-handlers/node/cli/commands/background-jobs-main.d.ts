import BaseCommand from "../../../../cli/base-command.js";
export type BackgroundJobsMainSignalProcess = {
    /**
     * - Registers one signal listener.
     */
    once: (event: "SIGINT" | "SIGTERM", listener: () => void) => BackgroundJobsMainSignalProcess;
    /**
     * - Removes one signal listener.
     */
    removeListener: (event: "SIGINT" | "SIGTERM", listener: () => void) => BackgroundJobsMainSignalProcess;
};
export type BackgroundJobsMainShutdownOwner = {
    /**
     * - Stops the main gracefully.
     */
    stop: () => Promise<void>;
    /**
     * - Waits until the main has stopped.
     */
    waitUntilStopped: () => Promise<void>;
};
/**
 * BackgroundJobsMainSignalProcess type.
 * @typedef {object} BackgroundJobsMainSignalProcess
 * @property {(event: "SIGINT" | "SIGTERM", listener: () => void) => BackgroundJobsMainSignalProcess} once - Registers one signal listener.
 * @property {(event: "SIGINT" | "SIGTERM", listener: () => void) => BackgroundJobsMainSignalProcess} removeListener - Removes one signal listener.
 */
/**
 * BackgroundJobsMainShutdownOwner type.
 * @typedef {object} BackgroundJobsMainShutdownOwner
 * @property {() => Promise<void>} stop - Stops the main gracefully.
 * @property {() => Promise<void>} waitUntilStopped - Waits until the main has stopped.
 */
/**
 * Owns process shutdown signals before publishing the main's readiness boundary.
 * @param {object} args - Shutdown ownership options.
 * @param {BackgroundJobsMainShutdownOwner} args.main - Running background-jobs main.
 * @param {() => void} args.onReady - Publishes readiness after signal ownership exists.
 * @param {BackgroundJobsMainSignalProcess} [args.processObject] - Process-like signal emitter.
 * @returns {Promise<void>} - Resolves when the main stops.
 */
export declare function waitForBackgroundJobsMainShutdown({ main, onReady, processObject }: {
    main: BackgroundJobsMainShutdownOwner;
    onReady: () => void;
    processObject?: BackgroundJobsMainSignalProcess;
}): Promise<void>;
export default class BackgroundJobsMainCommand extends BaseCommand {
    execute(): Promise<void>;
}
//# sourceMappingURL=background-jobs-main.d.ts.map