export type InstallSqlJsWasmRouteArgs = {
    /**
     * - Velocious configuration instance.
     */
    configuration: import("../configuration.js").default;
    /**
     * - Route prefix used for sql.js asset serving.
     */
    routePrefix?: string;
};
export type SqlJsLocateFileFromBackendArgs = {
    /**
     * - Backend base URL (for example `https://api.example.com`).
     */
    backendBaseUrl: string;
    /**
     * - Route prefix used for sql.js asset serving.
     */
    routePrefix?: string;
};
/**
 * Installs a route-resolver hook that serves `sql.js/dist/*` files from the running Velocious backend.
 * @param {InstallSqlJsWasmRouteArgs} args - Options object.
 * @returns {void} - No return value.
 */
export default function installSqlJsWasmRoute(args: InstallSqlJsWasmRouteArgs): void;
/**
 * Creates a sqlite-web `locateFile(file)` callback pointing to a Velocious backend route.
 * @param {SqlJsLocateFileFromBackendArgs} args - Options object.
 * @returns {(file: string) => string} - sql.js locateFile callback.
 */
export declare function sqlJsLocateFileFromBackend(args: SqlJsLocateFileFromBackendArgs): (file: string) => string;
//# sourceMappingURL=sqljs-wasm-route.d.ts.map