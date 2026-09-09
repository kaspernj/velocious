export type WithCountEntry = {
    /**
     * - Attribute to set on each parent record holding the count.
     */
    attributeName: string;
    /**
     * - Has-many relationship whose rows are counted.
     */
    relationshipName: string;
    /**
     * - Optional extra where clause applied to the count query.
     */
    where: Record<string, ReturnType<typeof JSON.parse>> | undefined;
};
export type WithCountSpec = string | string[] | Record<string, boolean | {
    relationship?: string;
    where?: Record<string, ReturnType<typeof JSON.parse>>;
}>;
/**
 * WithCountEntry type.
 * @typedef {object} WithCountEntry
 * @property {string} attributeName - Attribute to set on each parent record holding the count.
 * @property {string} relationshipName - Has-many relationship whose rows are counted.
 * @property {Record<string, ReturnType<typeof JSON.parse>> | undefined} where - Optional extra where clause applied to the count query.
 */
/**
 * Defines this typedef.
 * @typedef {string | string[] | Record<string, boolean | {relationship?: string, where?: Record<string, ReturnType<typeof JSON.parse>>}>} WithCountSpec
 */
/**
 * Normalize the flexible user-facing `.withCount(...)` argument into the
 * strict internal list of {attributeName, relationshipName, where} entries
 * the runner consumes.
 *
 * Accepted shapes:
 *   "projects"                                         → one entry
 *   ["projects", "timelogs"]                           → one entry per name
 *   {projects: true}                                   → one entry (attr = "projectsCount")
 *   {activeMembersCount:                               → custom attribute name
 *     {relationship: "users", where: {active: true}}}
 * @param {WithCountSpec} spec - User-supplied spec.
 * @returns {WithCountEntry[]} - Normalized entries.
 */
export declare function normalizeWithCount(spec: WithCountSpec): WithCountEntry[];
/**
 * Run every withCount entry against the loaded parent records, attaching
 * the resulting counts as attributes on each record. Mirrors the
 * Preloader's data-flow shape — one grouped count query per entry, then
 * `setAttribute` on each parent.
 * @param {object} args - Options.
 * @param {import("../record/index.js").default[]} args.models - Loaded parent records.
 * @param {typeof import("../record/index.js").default} args.modelClass - Parent model class.
 * @param {WithCountEntry[]} args.entries - Normalized withCount entries.
 * @returns {Promise<void>}
 */
export declare function runWithCount({ models, modelClass, entries }: {
    models: import("../record/index.js").default[];
    modelClass: typeof import("../record/index.js").default;
    entries: WithCountEntry[];
}): Promise<void>;
//# sourceMappingURL=with-count.d.ts.map