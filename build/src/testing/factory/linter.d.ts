/**
 * Executes registered factories (and optionally their traits) to prove they build
 * and persist, aggregating every failure by case. For the create strategy each
 * case runs inside the model's ambient transaction and is rolled back, so no rows
 * remain in the supported single-connection case. External callback side effects
 * are not reversible and cross-database writes are not globally atomic.
 */
export default class FactoryLinter {
    /** @type {import("./factory-registry.js").default} - Registry to lint. */
    registry: import("./factory-registry.js").default;
    /**
     * Builds a linter.
     * @param {import("./factory-registry.js").default} registry - Registry to lint.
     */
    constructor(registry: import("./factory-registry.js").default);
    /**
     * Lints selected factories and reports every failure together.
     * @param {object} [options] - Options.
     * @param {string[]} [options.factories] - Factory names to lint. Defaults to all.
     * @param {boolean} [options.traits] - Whether to also lint each factory's local traits.
     * @param {"attributesFor" | "build" | "create"} [options.strategy] - Strategy to lint with. Defaults to create.
     * @returns {Promise<void>} - Resolves when every case passed; rejects with an aggregate otherwise.
     */
    lint({ factories, traits, strategy }?: {
        factories?: string[];
        traits?: boolean;
        strategy?: "attributesFor" | "build" | "create";
    }): Promise<void>;
    /**
     * Resolves the unique set of factory definitions to lint.
     * @param {string[] | undefined} factories - Explicit names, or undefined for all.
     * @returns {import("./factory-definition.js").default[]} - Unique definitions.
     */
    _selectDefinitions(factories: string[] | undefined): import("./factory-definition.js").default[];
    /**
     * Lints one factory/trait case, rolling back create-strategy persistence.
     * @param {import("./factory-definition.js").default} definition - Factory definition.
     * @param {string[]} traits - Traits to apply for this case.
     * @param {"attributesFor" | "build" | "create"} strategy - Strategy to run.
     * @param {Array<{label: string, error: ReturnType<typeof JSON.parse>}>} failures - Failure sink.
     * @returns {Promise<void>} - Resolves when the case has been evaluated.
     */
    _lintCase(definition: import("./factory-definition.js").default, traits: string[], strategy: "attributesFor" | "build" | "create", failures: Array<{
        label: string;
        error: ReturnType<typeof JSON.parse>;
    }>): Promise<void>;
    /**
     * Runs a create-strategy case inside a transaction and forces a rollback.
     * @param {import("./factory-definition.js").default} definition - Factory definition.
     * @param {string[]} traits - Traits to apply.
     * @returns {Promise<void>} - Resolves (or rejects) once the rollback completes.
     */
    _lintCreateCase(definition: import("./factory-definition.js").default, traits: string[]): Promise<void>;
}
//# sourceMappingURL=linter.d.ts.map