// @ts-check
/**
 * @typedef {object} MigrationObjectType
 * @property {number} date - Migration timestamp parsed from filename.
 * @property {string} file - Filename for the migration.
 * @property {string} [fullPath] - Absolute path to the migration file.
 * @property {string} migrationClassName - Exported migration class name.
 */
/**
 * @typedef {() => typeof import("../migration/index.js").default} ImportCallbackType
 */
/**
 * @typedef {(arg: string) => Promise<typeof import("../migration/index.js").default>} ImportFullpathCallbackType
 */
/**
 * @typedef {() => Promise<typeof import("../migration/index.js").default>} RequireMigrationType
 */
/**
 * @typedef {(id: string) => {default: typeof import("../migration/index.js").default}} RequireMigrationContextRequireType
 * @typedef {RequireMigrationContextRequireType & {
 *   keys: () => string[],
 *   id: string
 * }} RequireMigrationContextType
 */
export {};
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidHlwZXMuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9zcmMvZGF0YWJhc2UvbWlncmF0b3IvdHlwZXMuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaOzs7Ozs7R0FNRztBQUVIOztHQUVHO0FBRUg7O0dBRUc7QUFFSDs7R0FFRztBQUVIOzs7Ozs7R0FNRztBQUVILE9BQU8sRUFBRSxDQUFBIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbi8qKlxuICogQHR5cGVkZWYge29iamVjdH0gTWlncmF0aW9uT2JqZWN0VHlwZVxuICogQHByb3BlcnR5IHtudW1iZXJ9IGRhdGUgLSBNaWdyYXRpb24gdGltZXN0YW1wIHBhcnNlZCBmcm9tIGZpbGVuYW1lLlxuICogQHByb3BlcnR5IHtzdHJpbmd9IGZpbGUgLSBGaWxlbmFtZSBmb3IgdGhlIG1pZ3JhdGlvbi5cbiAqIEBwcm9wZXJ0eSB7c3RyaW5nfSBbZnVsbFBhdGhdIC0gQWJzb2x1dGUgcGF0aCB0byB0aGUgbWlncmF0aW9uIGZpbGUuXG4gKiBAcHJvcGVydHkge3N0cmluZ30gbWlncmF0aW9uQ2xhc3NOYW1lIC0gRXhwb3J0ZWQgbWlncmF0aW9uIGNsYXNzIG5hbWUuXG4gKi9cblxuLyoqXG4gKiBAdHlwZWRlZiB7KCkgPT4gdHlwZW9mIGltcG9ydChcIi4uL21pZ3JhdGlvbi9pbmRleC5qc1wiKS5kZWZhdWx0fSBJbXBvcnRDYWxsYmFja1R5cGVcbiAqL1xuXG4vKipcbiAqIEB0eXBlZGVmIHsoYXJnOiBzdHJpbmcpID0+IFByb21pc2U8dHlwZW9mIGltcG9ydChcIi4uL21pZ3JhdGlvbi9pbmRleC5qc1wiKS5kZWZhdWx0Pn0gSW1wb3J0RnVsbHBhdGhDYWxsYmFja1R5cGVcbiAqL1xuXG4vKipcbiAqIEB0eXBlZGVmIHsoKSA9PiBQcm9taXNlPHR5cGVvZiBpbXBvcnQoXCIuLi9taWdyYXRpb24vaW5kZXguanNcIikuZGVmYXVsdD59IFJlcXVpcmVNaWdyYXRpb25UeXBlXG4gKi9cblxuLyoqXG4gKiBAdHlwZWRlZiB7KGlkOiBzdHJpbmcpID0+IHtkZWZhdWx0OiB0eXBlb2YgaW1wb3J0KFwiLi4vbWlncmF0aW9uL2luZGV4LmpzXCIpLmRlZmF1bHR9fSBSZXF1aXJlTWlncmF0aW9uQ29udGV4dFJlcXVpcmVUeXBlXG4gKiBAdHlwZWRlZiB7UmVxdWlyZU1pZ3JhdGlvbkNvbnRleHRSZXF1aXJlVHlwZSAmIHtcbiAqICAga2V5czogKCkgPT4gc3RyaW5nW10sXG4gKiAgIGlkOiBzdHJpbmdcbiAqIH19IFJlcXVpcmVNaWdyYXRpb25Db250ZXh0VHlwZVxuICovXG5cbmV4cG9ydCB7fVxuIl19