import BaseCommand from "../../../../cli/base-command.js";
export default class VelociousCliCommandsServer extends BaseCommand {
    output: string;
    /**
     * Runs normalize action name.
     * @param {string} actionName - Raw route action name.
     * @returns {string} - Normalized method name.
     */
    normalizeActionName(actionName: string): string;
    execute(): Promise<{
        output: string;
    }>;
    /**
     * Runs print routes.
     * @param {import("../../../../routes/base-route.js").default} route - Route.
     * @param {number} [level] - Level.
     * @returns {void} - No return value.
     */
    printRoutes(route: import("../../../../routes/base-route.js").default, level?: number): void;
    /**
     * Runs log.
     * @param {string} content - Content.
     * @returns {void} - No return value.
     */
    log(content: string): void;
}
//# sourceMappingURL=routes.d.ts.map