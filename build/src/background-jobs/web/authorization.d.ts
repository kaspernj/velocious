/**
 * Decides whether a jobs-dashboard request is authorized. Order of precedence:
 * a matching bearer token, then the host-supplied `authorize` callback. When
 * neither tokens nor an authorize callback are configured, access falls back to
 * loopback-only so a freshly mounted dashboard is reachable on the same host
 * during development without being exposed to the network.
 * @param {object} args - Options.
 * @param {import("./registry.js").JobsMountOptions} args.options - Mount options.
 * @param {import("../../http-server/client/request.js").default | import("../../http-server/client/websocket-request.js").default} args.request - Request object.
 * @param {import("../../configuration.js").default} args.configuration - Configuration instance.
 * @param {import("../../authorization/ability.js").default | undefined} args.ability - Current ability.
 * @param {string | null} [args.token] - Explicit websocket subscription token.
 * @returns {Promise<boolean>} - Whether the request is authorized.
 */
export declare function authorizeJobsRequest({ ability, configuration, options, request, token: explicitToken }: {
    options: import("./registry.js").JobsMountOptions;
    request: import("../../http-server/client/request.js").default | import("../../http-server/client/websocket-request.js").default;
    configuration: import("../../configuration.js").default;
    ability: import("../../authorization/ability.js").default | undefined;
    token?: string | null;
}): Promise<boolean>;
//# sourceMappingURL=authorization.d.ts.map