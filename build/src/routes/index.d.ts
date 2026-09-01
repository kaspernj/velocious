import RootRoute from "./root-route.js";
export default class VelociousRoutes {
    rootRoute: RootRoute;
    /**
     * Runs draw.
     * @param {(arg: import("./root-route.js").default) => void} callback - Callback function.
     * @returns {void} - No return value.
     */
    draw(callback: (arg: import("./root-route.js").default) => void): void;
    /**
     * Collects all `route.mount(...)` registrations across the route tree so the
     * configuration can apply them when the routes are set.
     * @returns {Array<{mountable: {mountInto: (args: object) => void}, options: Record<string, ReturnType<typeof JSON.parse>>}>} - Declared mounts.
     */
    getMounts(): Array<{
        mountable: {
            mountInto: (args: object) => void;
        };
        options: Record<string, ReturnType<typeof JSON.parse>>;
    }>;
}
//# sourceMappingURL=index.d.ts.map