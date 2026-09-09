export type LoggingOutputPayload = import("../../configuration-types.js").LoggingOutputPayload;
/**
 * LoggingOutputPayload type.
 * @typedef {import("../../configuration-types.js").LoggingOutputPayload} LoggingOutputPayload */
/** Logger file output. */
export default class LoggerFileOutput {
    /**
     * Configuration.
     * @type {import("../../configuration.js").default | undefined} */
    _configuration: import("../../configuration.js").default | undefined;
    /**
     * File path.
     * @type {string | undefined} */
    _filePath: string | undefined;
    /**
     * Get configuration.
     * @type {(() => import("../../configuration.js").default | undefined) | undefined} */
    _getConfiguration: (() => import("../../configuration.js").default | undefined) | undefined;
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("../../configuration.js").default} [args.configuration] - Configuration instance.
     * @param {() => import("../../configuration.js").default | undefined} [args.getConfiguration] - Configuration resolver.
     * @param {string} args.filePath - File path.
     */
    constructor({ configuration, getConfiguration, filePath }: {
        configuration?: import("../../configuration.js").default;
        getConfiguration?: () => import("../../configuration.js").default | undefined;
        filePath: string;
    });
    /**
     * Runs write.
     * @param {LoggingOutputPayload} payload - Log payload.
     */
    write({ message }: LoggingOutputPayload): Promise<void>;
}
//# sourceMappingURL=file-output.d.ts.map