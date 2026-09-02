import BaseCommand from "../../../../cli/base-command.js";
export type SignalProcess = {
    /**
     * - Register one signal listener.
     */
    once: (event: "SIGINT" | "SIGTERM", listener: () => void) => SignalProcess;
    /**
     * - Remove one signal listener.
     */
    removeListener: (event: "SIGINT" | "SIGTERM", listener: () => void) => SignalProcess;
};
export type SignalShutdownApplication = {
    /**
     * - Stop the application gracefully.
     */
    stop: () => Promise<void>;
    /**
     * - Wait until the application closes.
     */
    wait: () => Promise<void>;
};
/**
 * SignalProcess type.
 * @typedef {object} SignalProcess
 * @property {(event: "SIGINT" | "SIGTERM", listener: () => void) => SignalProcess} once - Register one signal listener.
 * @property {(event: "SIGINT" | "SIGTERM", listener: () => void) => SignalProcess} removeListener - Remove one signal listener.
 */
/**
 * SignalShutdownApplication type.
 * @typedef {object} SignalShutdownApplication
 * @property {() => Promise<void>} stop - Stop the application gracefully.
 * @property {() => Promise<void>} wait - Wait until the application closes.
 */
/**
 * Waits for the HTTP application to close, stopping it gracefully when the
 * process receives SIGINT or SIGTERM.
 * @param {object} args - Wait options.
 * @param {SignalShutdownApplication} args.application - Running application.
 * @param {SignalProcess} [args.processObject] - Process-like signal emitter.
 * @returns {Promise<void>} - Resolves when the application has stopped.
 */
export declare function waitForApplicationWithSignalShutdown({ application, processObject }: {
    application: SignalShutdownApplication;
    processObject?: SignalProcess;
}): Promise<void>;
/**
 * Runs the httpServerConfigFromParsedArgs helper.
 * @param {Record<string, string | number | boolean | undefined>} parsedProcessArgs - Parsed CLI args.
 * @param {import("../../../../configuration-types.js").HttpServerConfiguration} [defaults] - Default HTTP server config.
 * @returns {{host: string, port: number, workers?: number}} - HTTP server config.
 */
export declare function httpServerConfigFromParsedArgs(parsedProcessArgs?: Record<string, string | number | boolean | undefined>, defaults?: import("../../../../configuration-types.js").HttpServerConfiguration): {
    host: string;
    port: number;
    workers?: number;
};
export default class VelociousCliCommandsServer extends BaseCommand {
    /**
     * Runs execute.
     * @returns {Promise<void>} - Starts the HTTP server and waits until it stops.
     */
    execute(): Promise<void>;
}
//# sourceMappingURL=server.d.ts.map