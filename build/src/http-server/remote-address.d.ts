/**
 * Runs resolve remote address.
 * @param {object} args - Options object.
 * @param {import("../configuration.js").default} args.configuration - Configuration instance.
 * @param {Record<string, string | string[]>} args.headers - Request headers.
 * @param {string | undefined} args.socketRemoteAddress - Socket peer address.
 * @returns {string | undefined} - Resolved client remote address.
 */
export default function resolveRemoteAddress({ configuration, headers, socketRemoteAddress }: {
    configuration: import("../configuration.js").default;
    headers: Record<string, string | string[]>;
    socketRemoteAddress: string | undefined;
}): string | undefined;
//# sourceMappingURL=remote-address.d.ts.map