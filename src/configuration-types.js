// @ts-check

/**
 * @module types
 */

/**
 * @typedef {function({request: import("./http-server/client/request.js").default | import("./http-server/client/websocket-request.js").default, response: import("./http-server/client/response.js").default}): Promise<void>} CorsType
 */

/**
 * @typedef {function({request: import("./http-server/client/request.js").default | import("./http-server/client/websocket-request.js").default | undefined, subscription?: {channel: string, params?: Record<string, unknown>}, client: import("./http-server/client/index.js").default, websocketSession: import("./http-server/client/websocket-session.js").default, configuration: import("./configuration.js").default}): typeof import("./http-server/websocket-channel.js").default | import("./http-server/websocket-channel.js").default | void | Promise<typeof import("./http-server/websocket-channel.js").default | import("./http-server/websocket-channel.js").default | void>} WebsocketChannelResolverType
 */

/**
 * @typedef {object} WebsocketMessageHandler
 * @property {function({message: any, session: import("./http-server/client/websocket-session.js").default}) : Promise<void> | void} [onMessage] - Handler for incoming websocket messages.
 * @property {function({session: import("./http-server/client/websocket-session.js").default}) : Promise<void> | void} [onOpen] - Handler when the websocket session opens.
 * @property {function({session: import("./http-server/client/websocket-session.js").default}) : Promise<void> | void} [onClose] - Handler when the websocket session closes.
 * @property {function({error: Error, session: import("./http-server/client/websocket-session.js").default}) : Promise<void> | void} [onError] - Handler when a websocket message errors.
 */

/**
 * @typedef {function({request: import("./http-server/client/request.js").default | import("./http-server/client/websocket-request.js").default | undefined, client: import("./http-server/client/index.js").default, configuration: import("./configuration.js").default}): WebsocketMessageHandler | void | Promise<WebsocketMessageHandler | void>} WebsocketMessageHandlerResolverType
 */

/**
 * @typedef {(id: string) => {default: typeof import("./initializer.js").default}} InitializersRequireContextType
 * @typedef {InitializersRequireContextType & {
 *   keys: () => string[],
 *   id: string
 * }} WebpackRequireContext
 * @typedef {{requireContext: WebpackRequireContext}} InitializersExportType
 * @typedef {function({configuration: import("./configuration.js").default}) : Promise<InitializersExportType>} InitializersType
 */

/**
 * @typedef {object} SqlConfig
 * @property {string} [database] - Database name for the SQL driver.
 * @property {object} [options] - Driver-specific connection options.
 * @property {boolean} [options.encrypt] - Whether to encrypt the connection (MSSQL).
 * @property {string} [options.serverName] - TLS SNI server name override for MSSQL (empty string disables SNI).
 * @property {boolean} [options.trustServerCertificate] - Whether to trust the server certificate (MSSQL).
 * @property {string} [password] - Password for the SQL user.
 * @property {object} [pool] - Connection pool configuration.
 * @property {number} [pool.max] - Maximum number of connections.
 * @property {number} [pool.min] - Minimum number of connections.
 * @property {number} [pool.idleTimeoutMillis] - Idle timeout before releasing a connection.
 * @property {string} [server] - SQL server hostname.
 * @property {string} [user] - SQL username.
 */

/**
 * @typedef {object} DatabaseConfigurationType
 * @property {string} [database] - Database name for this connection.
 * @property {typeof import("./database/drivers/base.js").default} [driver] - Driver class to use for this database.
 * @property {typeof import("./database/pool/base.js").default} [poolType] - Pool class to use for this database.
 * @property {function() : unknown} [getConnection] - Custom connection factory override.
 * @property {string} [host] - Database host.
 * @property {boolean} [migrations] - Whether migrations are enabled for this database.
 * @property {string} [password] - Password for the database user.
 * @property {number} [port] - Database port.
 * @property {string} [name] - Friendly name for the configuration.
 * @property {boolean} [readOnly] - Whether writes should be blocked for this database.
 * @property {object} [record] - Record-level configuration.
 * @property {boolean} [record.transactions] - Whether record operations should use transactions.
 * @property {boolean} [reset] - Whether to reset the database on startup.
 * @property {SqlConfig} [sqlConfig] - Driver-specific SQL config.
 * @property {"mssql" | "mysql" | "pgsql" | "sqlite"} [type] - Database type identifier.
 * @property {string} [useDatabase] - Database to switch to after connecting.
 * @property {string} [username] - Username for database authentication.
 */

/**
 * @typedef {object} LoggingConfiguration
 * @property {boolean} [console] - Enable/disable console logging for request logging. Defaults to true outside of "test" and for HTTP server logs.
 * @property {boolean} [file] - Enable/disable writing logs to a file. Defaults to true.
 * @property {string} [directory] - Directory where log files are stored. Defaults to "<project>/log".
 * @property {string} [filePath] - Explicit path for the log file. Defaults to "<directory>/<environment>.log".
 * @property {Array<"debug-low-level" | "debug" | "info" | "warn" | "error">} [levels] - Override which log levels are emitted.
 * @property {boolean} [debugLowLevel] - Convenience flag to include very low-level debug logs.
 */

/**
 * @typedef {object} BackgroundJobsConfiguration
 * @property {string} [host] - Hostname for the background jobs main process.
 * @property {number} [port] - Port for the background jobs main process.
 * @property {string} [databaseIdentifier] - Database identifier used to store background jobs.
 */

/**
 * @typedef {object} MailerBackend
 * @property {function({payload: import("./mailer.js").MailerDeliveryPayload, configuration: import("./configuration.js").default}) : Promise<unknown> | unknown} deliver - Deliver a mailer payload.
 */

/**
 * @typedef {Record<string, string[]>} LocaleFallbacksType
 */

/**
 * @typedef {object} ConfigurationArgsType
 * @property {CorsType} [cors] - CORS configuration for the HTTP server.
 * @property {string} [cookieSecret] - Secret for encrypting cookies.
 * @property {{[key: string]: {[key: string]: DatabaseConfigurationType}}} database - Database configurations keyed by environment and identifier.
 * @property {boolean} [debug] - Enable debug logging.
 * @property {string} [directory] - Base directory for the project.
 * @property {string} [environment] - Current environment name.
 * @property {import("./environment-handlers/base.js").default} environmentHandler - Environment handler instance.
 * @property {LoggingConfiguration} [logging] - Logging configuration.
 * @property {BackgroundJobsConfiguration} [backgroundJobs] - Background jobs configuration.
 * @property {MailerBackend} [mailerBackend] - Mail delivery backend.
 * @property {function({configuration: import("./configuration.js").default, type: string}) : void} initializeModels - Hook to register models for a given initialization type.
 * @property {InitializersType} [initializers] - Initializer loader for environment bootstrapping.
 * @property {string | function() : string} locale - Default locale or locale resolver.
 * @property {string[]} locales - Supported locales.
 * @property {LocaleFallbacksType} localeFallbacks - Locale fallback map.
 * @property {string} [testing] - Path to the testing configuration file.
 * @property {number | (() => number)} [timezoneOffsetMinutes] - Default timezone offset in minutes.
 * @property {number | (() => number)} [requestTimeoutMs] - Timeout in seconds for completing a HTTP request.
 * @property {WebsocketChannelResolverType} [websocketChannelResolver] - Resolve a websocket channel class/instance for each connection.
 * @property {WebsocketMessageHandlerResolverType} [websocketMessageHandlerResolver] - Resolve a raw websocket message handler for each connection.
 */

export const nothing = {}
