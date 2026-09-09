/**
 * Registers gap-less positional list callbacks on a model class to maintain
 * a gap-less positional list. When a record is inserted, updated, or
 * destroyed, the surrounding positions are shifted so the list stays compact
 * (1,2,3,...) and scoped within the given column.
 *
 * Callers must also ensure a UNIQUE index on (scopeColumn, positionColumn)
 * exists in the database schema — use `Migration.addActsAsList()` for the
 * corresponding schema setup.
 * @param {typeof import("./index.js").default} modelClass - The model class.
 * @param {string} positionColumn - camelCase name of the position attribute (e.g. "rowNumber").
 * @param {object} options - Options.
 * @param {string} options.scope - camelCase name of the scope attribute (e.g. "boardColumnId").
 * @returns {void}
 */
export default function registerActsAsListCallbacks(modelClass: typeof import("./index.js").default, positionColumn: string, { scope }: {
    scope: string;
}): void;
//# sourceMappingURL=acts-as-list.d.ts.map