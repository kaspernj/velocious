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
 * @property {string} [options.schema] - Default schema for unqualified table lookups (MSSQL).
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
 * @property {(file: string) => string} [locateFile] - Optional sqlite-web sql.js wasm resolver (`initSqlJs({locateFile})`).
 * @property {boolean} [readOnly] - Whether writes should be blocked for this database.
 * @property {string} [schema] - Default schema for unqualified table lookups (MSSQL).
 * @property {object} [record] - Record-level configuration.
 * @property {boolean} [record.transactions] - Whether record operations should use transactions.
 * @property {boolean} [reset] - Whether to reset the database on startup.
 * @property {SqlConfig} [sqlConfig] - Driver-specific SQL config.
 * @property {"mssql" | "mysql" | "pgsql" | "sqlite"} [type] - Database type identifier.
 * @property {string} [useDatabase] - Database to switch to after connecting.
 * @property {string} [username] - Username for database authentication.
 */

/**
 * @typedef {"debug-low-level" | "debug" | "info" | "warn" | "error"} LogLevel
 */

/**
 * @typedef {object} LoggingOutputPayload
 * @property {LogLevel} level - Log level.
 * @property {string} message - Formatted message.
 * @property {string} subject - Log subject.
 * @property {Date} timestamp - Timestamp.
 */

/**
 * @typedef {object} LoggingOutput
 * @property {function(LoggingOutputPayload): Promise<void> | void} write - Write a log entry.
 * @property {LogLevel[]} [levels] - Default levels for this output.
 */

/**
 * @typedef {object} LoggingOutputConfig
 * @property {LoggingOutput} output - Output instance.
 * @property {Array<LogLevel>} [levels] - Levels enabled for this output.
 */

/**
 * @typedef {LoggingOutputConfig | LoggingOutput | import("./logger/base-logger.js").default} LoggerConfig
 */

/**
 * @typedef {object} LoggingConfiguration
 * @property {boolean} [console] - Enable/disable console logging for request logging. Defaults to true outside of "test" and for HTTP server logs.
 * @property {boolean} [file] - Enable/disable writing logs to a file. Defaults to true.
 * @property {string} [directory] - Directory where log files are stored. Defaults to "<project>/log".
 * @property {string} [filePath] - Explicit path for the log file. Defaults to "<directory>/<environment>.log".
 * @property {Array<"debug-low-level" | "debug" | "info" | "warn" | "error">} [levels] - Override which log levels are emitted.
 * @property {boolean} [debugLowLevel] - Convenience flag to include very low-level debug logs.
 * @property {LoggerConfig[]} [loggers] - Logger instances (converted to outputs when configured).
 * @property {LoggingOutputConfig[]} [outputs] - Explicit logger outputs (overrides console/file defaults when provided).
 */

/**
 * @typedef {object} StructureSqlConfiguration
 * @property {string[]} [disabledEnvironments] - Environments that should skip writing structure sql files.
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
 * @typedef {object} FrontendModelRelationshipConfiguration
 * @property {"belongsTo" | "hasOne" | "hasMany"} type - Relationship type.
 * @property {string} [model] - Target model class name.
 * @property {string} [className] - Alias of target model class name.
 * @property {string} [modelClassName] - Explicit target model class name.
 */

/**
 * @typedef {object} FrontendModelAttributeConfiguration
 * @property {string} [type] - Column type name.
 * @property {string} [columnType] - Alias for column type name.
 * @property {string} [sqlType] - Alias for column type name.
 * @property {string} [dataType] - Alias for column type name.
 * @property {boolean} [null] - Whether value can be null.
 * @property {boolean} [nullable] - Alias for nullability.
 * @property {boolean} [notNull] - Inverse nullability flag.
 */

/**
 * @typedef {object} FrontendModelResourceConfiguration
 * @property {string[] | Record<string, FrontendModelAttributeConfiguration | import("./database/drivers/base-column.js").default | boolean>} attributes - Attributes to expose on the frontend model.
 * @property {FrontendModelResourceAbilitiesConfiguration} abilities - Ability actions keyed by frontend command (`index`, `find`, `create`, `update`, `destroy`).
 * @property {Record<string, string>} [commands] - Command names keyed by action (`index`, `find`, `update`, `destroy`).
 * @property {Record<string, FrontendModelRelationshipConfiguration>} [relationships] - Relationship helpers to generate for frontend model files.
 * @property {string} [path] - HTTP path prefix used by frontend model commands.
 * @property {string} [primaryKey] - Primary key attribute name.
 * @property {FrontendModelResourceServerConfiguration} [server] - Optional backend behavior overrides for built-in frontend actions.
 */

/**
 * @typedef {object} FrontendModelResourceAbilitiesConfiguration
 * @property {string} [index] - Ability action for frontend index.
 * @property {string} [find] - Ability action for frontend find.
 * @property {string} [create] - Ability action for frontend create.
 * @property {string} [update] - Ability action for frontend update.
 * @property {string} [destroy] - Ability action for frontend destroy.
 */

/**
 * @typedef {object} FrontendModelResourceServerConfiguration
 * @property {function({action: "index" | "find" | "update" | "destroy", controller: import("./controller.js").default, params: Record<string, any>, modelClass: typeof import("./database/record/index.js").default}) : (boolean | void | Promise<boolean | void>)} [beforeAction] - Optional callback run before built-in frontend actions.
 * @property {function({action: "index", controller: import("./controller.js").default, params: Record<string, any>, modelClass: typeof import("./database/record/index.js").default}) : Promise<import("./database/record/index.js").default[]>} [records] - Records loader for frontendIndex.
 * @property {function({action: "index" | "find" | "update", controller: import("./controller.js").default, params: Record<string, any>, modelClass: typeof import("./database/record/index.js").default, model: import("./database/record/index.js").default}) : Record<string, any> | Promise<Record<string, any>>} [serialize] - Record serializer for response payloads.
 * @property {function({action: "find" | "update" | "destroy", controller: import("./controller.js").default, params: Record<string, any>, modelClass: typeof import("./database/record/index.js").default, id: string | number}) : Promise<import("./database/record/index.js").default | null>} [find] - Record loader for find/update/destroy actions.
 * @property {function({action: "update", controller: import("./controller.js").default, params: Record<string, any>, modelClass: typeof import("./database/record/index.js").default, model: import("./database/record/index.js").default, attributes: Record<string, any>}) : Promise<import("./database/record/index.js").default | void>} [update] - Custom update callback.
 * @property {function({action: "destroy", controller: import("./controller.js").default, params: Record<string, any>, modelClass: typeof import("./database/record/index.js").default, model: import("./database/record/index.js").default}) : Promise<void>} [destroy] - Custom destroy callback.
 */

/**
 * @typedef {object} BackendProjectConfiguration
 * @property {string} path - Path to the backend project.
 * @property {string} [frontendModelsOutputPath] - Optional output project path where `src/frontend-models` should be generated.
 * @property {Record<string, FrontendModelResourceConfiguration>} [frontendModels] - Frontend model definitions keyed by model class name.
 * @property {Record<string, FrontendModelResourceConfiguration>} [resources] - Alias for `frontendModels`.
 */

/**
 * @typedef {object} RouteResolverHookArgs
 * @property {import("./configuration.js").default} configuration - Configuration instance.
 * @property {Record<string, any>} params - Mutable request params object.
 * @property {string} currentPath - Request path without query.
 * @property {import("./http-server/client/request.js").default | import("./http-server/client/websocket-request.js").default} request - Request object.
 * @property {import("./http-server/client/response.js").default} response - Response object.
 * @property {import("./routes/resolver.js").default} resolver - Resolver instance.
 */

/**
 * @typedef {object} RouteResolverHookResult
 * @property {string} action - Dasherized action name (for example `frontend-index`).
 * @property {string} controller - Controller path (for example `accounts`).
 * @property {typeof import("./controller.js").default} [controllerClass] - Optional controller class override.
 * @property {string} [controllerPath] - Optional absolute/relative controller file path override.
 * @property {Record<string, any>} [params] - Extra params to merge for controller/action.
 * @property {string} [viewPath] - Optional view path override used by controller render lookups.
 */

/**
 * @typedef {function(RouteResolverHookArgs) : RouteResolverHookResult | null | Promise<RouteResolverHookResult | null>} RouteResolverHookType
 */

/**
 * @typedef {typeof import("./authorization/base-resource.js").default} AbilityResourceClassType
 */

/**
 * @typedef {function({configuration: import("./configuration.js").default, params: Record<string, any>, request: import("./http-server/client/request.js").default | import("./http-server/client/websocket-request.js").default, response: import("./http-server/client/response.js").default}) : import("./authorization/ability.js").default | void | Promise<import("./authorization/ability.js").default | void>} AbilityResolverType
 */

/**
 * @typedef {object} ConfigurationArgsType
 * @property {CorsType} [cors] - CORS configuration for the HTTP server.
 * @property {string} [cookieSecret] - Secret for encrypting cookies.
 * @property {AbilityResourceClassType[]} [abilityResources] - Resource classes used to define abilities per model.
 * @property {AbilityResolverType} [abilityResolver] - Resolver for creating request-scoped ability instances.
 * @property {BackendProjectConfiguration[]} [backendProjects] - Backend project definitions used for frontend model generation.
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
 * @property {StructureSqlConfiguration} [structureSql] - Structure SQL generation configuration.
 * @property {string} [testing] - Path to the testing configuration file.
 * @property {number | (() => number)} [timezoneOffsetMinutes] - Default timezone offset in minutes.
 * @property {number | (() => number)} [requestTimeoutMs] - Timeout in seconds for completing a HTTP request.
 * @property {RouteResolverHookType[]} [routeResolverHooks] - Hook callbacks that can hijack unresolved routes.
 * @property {WebsocketChannelResolverType} [websocketChannelResolver] - Resolve a websocket channel class/instance for each connection.
 * @property {WebsocketMessageHandlerResolverType} [websocketMessageHandlerResolver] - Resolve a raw websocket message handler for each connection.
 */

export const nothing = {}
