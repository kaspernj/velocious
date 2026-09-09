export type DatabaseAnnotationsRuntime = {
    getDatabaseAnnotations?: () => string[];
    withDatabaseAnnotation?: (annotation: string, callback: () => Promise<ReturnType<typeof JSON.parse>>) => Promise<ReturnType<typeof JSON.parse>>;
};
/**
 * Runs get database annotations.
 * @returns {string[]} - Active database annotations for the current async context.
 */
declare function getDatabaseAnnotations(): string[];
/**
 * Runs the callback with an annotation that is appended to database query comments.
 * @template T
 * @param {string} annotation - Human-readable annotation for queries executed inside the callback.
 * @param {() => Promise<T>} callback - Callback to execute inside the annotation context.
 * @returns {Promise<T>} - Resolves with the callback result.
 */
declare function withDatabaseAnnotation<T>(annotation: string, callback: () => Promise<T>): Promise<T>;
export { getDatabaseAnnotations, withDatabaseAnnotation };
//# sourceMappingURL=annotations.d.ts.map