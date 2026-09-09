// @ts-check
import { pathToFileURL } from "node:url";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { reserveDefinitionReloadBudget } from "./definition-reload-policy.js";
/**
 * Monotonic cache-busting counter shared by reloads. Kept module-local so a reload
 * imports a fresh module instance rather than the cached one.
 * @type {number}
 */
let reloadCounter = 0;
/**
 * Recursively collects `.js` files under a directory in a deterministic
 * (lexicographically sorted) order.
 * @param {string} directory - Directory to scan.
 * @returns {Promise<string[]>} - Sorted absolute file paths.
 */
async function collectDirectoryFiles(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    /** @type {string[]} */
    const files = [];
    for (const entry of [...entries].sort((left, right) => (left.name < right.name ? -1 : 1))) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            files.push(...await collectDirectoryFiles(fullPath));
        }
        else if (entry.name.endsWith(".js")) {
            files.push(fullPath);
        }
    }
    return files;
}
/**
 * Resolves a load target (a single file, a directory, or an explicit list) into a
 * deterministic, de-duplicated list of absolute definition file paths.
 * @param {string | string[]} target - File path, directory, or list of paths.
 * @returns {Promise<string[]>} - Sorted, de-duplicated absolute file paths.
 */
async function resolveFiles(target) {
    if (Array.isArray(target)) {
        return [...new Set(target.map((entry) => path.resolve(entry)))].sort();
    }
    const resolved = path.resolve(target);
    const stats = await stat(resolved);
    if (stats.isDirectory())
        return await collectDirectoryFiles(resolved);
    return [resolved];
}
/**
 * Loads Velocious factory definition files (Node only). Each file must
 * default-export a `(registry) => void` function that defines into the registry.
 * Files load in deterministic path order. This module is intentionally Node-only
 * (filesystem + dynamic import) and must never be imported from browser/Metro
 * bundles; import the browser-safe core from `../index.js` there instead.
 * @param {import("../factory-registry.js").default} registry - Registry to define into.
 * @param {string | string[]} target - File path, directory, or list of paths.
 * @param {{reload?: boolean}} [options] - Options.
 * @returns {Promise<string[]>} - The loaded file paths, in load order.
 */
export async function loadDefinitions(registry, target, { reload = false } = {}) {
    const files = await resolveFiles(target);
    return await loadResolvedDefinitionFiles({ files, registry, reload });
}
/**
 * Loads definition files that have already been resolved into a deterministic
 * sorted list. When `reload` is set, the whole batch is preflighted and reserved
 * against the process-global import budget before any registry reset or import
 * attempt, so a rejected reload never mutates the registry.
 * @param {object} args - Options object.
 * @param {string[]} args.files - Resolved, sorted definition file paths.
 * @param {import("../factory-registry.js").default} args.registry - Registry to define into.
 * @param {boolean} args.reload - Whether to cache-bust the imports.
 * @param {boolean} [args.reset] - Whether to reset the registry first.
 * @returns {Promise<string[]>} - The loaded file paths, in load order.
 */
async function loadResolvedDefinitionFiles({ files, registry, reload, reset = false }) {
    if (reload)
        reserveDefinitionReloadBudget(files.length);
    if (reset)
        registry.reset();
    for (const file of files) {
        let href = pathToFileURL(file).href;
        if (reload) {
            reloadCounter += 1;
            href += `?factoryReload=${reloadCounter}`;
        }
        const module = await import(href);
        if (typeof module.default !== "function") {
            throw new Error(`Factory definition file ${file} must default-export a (registry) => void function`);
        }
        module.default(registry);
    }
    return files;
}
/**
 * Fully reloads definitions: resets the registry (dropping every factory, trait,
 * sequence, callback and default) and re-imports the target files with cache
 * busting so edited definitions take effect. The resolved batch is preflighted
 * against the process-global import budget before the reset, and a
 * `DefinitionRecycleRequiredError` is raised before any mutation when the batch
 * would exceed the budget.
 * @param {import("../factory-registry.js").default} registry - Registry to reload.
 * @param {string | string[]} target - File path, directory, or list of paths.
 * @returns {Promise<string[]>} - The reloaded file paths, in load order.
 */
export async function reloadDefinitions(registry, target) {
    const files = await resolveFiles(target);
    return await loadResolvedDefinitionFiles({ files, registry, reload: true, reset: true });
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibG9hZC1kZWZpbml0aW9ucy5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3NyYy90ZXN0aW5nL2ZhY3Rvcnkvbm9kZS9sb2FkLWRlZmluaXRpb25zLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLEVBQUUsYUFBYSxFQUFFLE1BQU0sVUFBVSxDQUFBO0FBQ3hDLE9BQU8sRUFBRSxPQUFPLEVBQUUsSUFBSSxFQUFFLE1BQU0sa0JBQWtCLENBQUE7QUFDaEQsT0FBTyxJQUFJLE1BQU0sV0FBVyxDQUFBO0FBQzVCLE9BQU8sRUFBRSw2QkFBNkIsRUFBRSxNQUFNLCtCQUErQixDQUFBO0FBRTdFOzs7O0dBSUc7QUFDSCxJQUFJLGFBQWEsR0FBRyxDQUFDLENBQUE7QUFFckI7Ozs7O0dBS0c7QUFDSCxLQUFLLFVBQVUscUJBQXFCLENBQUMsU0FBUztJQUM1QyxNQUFNLE9BQU8sR0FBRyxNQUFNLE9BQU8sQ0FBQyxTQUFTLEVBQUUsRUFBQyxhQUFhLEVBQUUsSUFBSSxFQUFDLENBQUMsQ0FBQTtJQUMvRCx1QkFBdUI7SUFDdkIsTUFBTSxLQUFLLEdBQUcsRUFBRSxDQUFBO0lBRWhCLEtBQUssTUFBTSxLQUFLLElBQUksQ0FBQyxHQUFHLE9BQU8sQ0FBQyxDQUFDLElBQUksQ0FBQyxDQUFDLElBQUksRUFBRSxLQUFLLEVBQUUsRUFBRSxDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksR0FBRyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDO1FBQzFGLE1BQU0sUUFBUSxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLEtBQUssQ0FBQyxJQUFJLENBQUMsQ0FBQTtRQUVqRCxJQUFJLEtBQUssQ0FBQyxXQUFXLEVBQUUsRUFBRSxDQUFDO1lBQ3hCLEtBQUssQ0FBQyxJQUFJLENBQUMsR0FBRyxN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QUMiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHsgcGF0aFRvRmlsZVVSTCB9IGZyb20gXCJub2RlOnVybFwiXG5pbXBvcnQgeyByZWFkZGlyLCBzdGF0IH0gZnJvbSBcIm5vZGU6ZnMvcHJvbWlzZXNcIlxuaW1wb3J0IHBhdGggZnJvbSBcIm5vZGU6cGF0aFwiXG5pbXBvcnQgeyByZXNlcnZlRGVmaW5pdGlvblJlbG9hZEJ1ZGdldCB9IGZyb20gXCIuL2RlZmluaXRpb24tcmVsb2FkLXBvbGljeS5qc1wiXG5cbi8qKlxuICogTW9ub3RvbmljIGNhY2hlLWJ1c3RpbmcgY291bnRlciBzaGFyZWQgYnkgcmVsb2Fkcy4gS2VwdCBtb2R1bGUtbG9jYWwgc28gYSByZWxvYWRcbiAqIGltcG9ydHMgYSBmcmVzaCBtb2R1bGUgaW5zdGFuY2UgcmF0aGVyIHRoYW4gdGhlIGNhY2hlZCBvbmUuXG4gKiBAdHlwZSB7bnVtYmVyfVxuICovXG5sZXQgcmVsb2FkQ291bnRlciA9IDBcblxuLyoqXG4gKiBSZWN1cnNpdmVseSBjb2xsZWN0cyBgLmpzYCBmaWxlcyB1bmRlciBhIGRpcmVjdG9yeSBpbiBhIGRldGVybWluaXN0aWNcbiAqIChsZXhpY29ncmFwaGljYWxseSBzb3J0ZWQpIG9yZGVyLlxuICogQHBhcmFtIHtzdHJpbmd9IGRpcmVjdG9yeSAtIERpcmVjdG9yeSB0byBzY2FuLlxuICogQHJldHVybnMge1Byb21pc2U8c3RyaW5nW10+fSAtIFNvcnRlZCBhYnNvbHV0ZSBmaWxlIHBhdGhzLlxuICovXG5hc3luYyBmdW5jdGlvbiBjb2xsZWN0RGlyZWN0b3J5RmlsZXMoZGlyZWN0b3J5KSB7XG4gIGNvbnN0IGVudHJpZXMgPSBhd2FpdCByZWFkZGlyKGRpcmVjdG9yeSwge3dpdGhGaWxlVHlwZXM6IHRydWV9KVxuICAvKiogQHR5cGUge3N0cmluZ1tdfSAqL1xuICBjb25zdCBmaWxlcyA9IFtdXG5cbiAgZm9yIChjb25zdCBlbnRyeSBvZiBbLi4uZW50cmllc10uc29ydCgobGVmdCwgcmlnaHQpID0+IChsZWZ0Lm5hbWUgPCByaWdodC5uYW1lID8gLTEgOiAxKSkpIHtcbiAgICBjb25zdCBmdWxsUGF0aCA9IHBhdGguam9pbihkaXJlY3RvcnksIGVudHJ5Lm5hbWUpXG5cbiAgICBpZiAoZW50cnkuaXNEaXJlY3RvcnkoKSkge1xuICAgICAgZmlsZXMucHVzaCguLi5hd2FpdCBjb2xsZWN0RGlyZWN0b3J5RmlsZXMoZnVsbFBhdGgpKVxuICAgIH0gZWxzZSBpZiAoZW50cnkubmFtZS5lbmRzV2l0aChcIi5qc1wiKSkge1xuICAgICAgZmlsZXMucHVzaChmdWxsUGF0aClcbiAgICB9XG4gIH1cblxuICByZXR1cm4gZmlsZXNcbn1cblxuLyoqXG4gKiBSZXNvbHZlcyBhIGxvYWQgdGFyZ2V0IChhIHNpbmdsZSBmaWxlLCBhIGRpcmVjdG9yeSwgb3IgYW4gZXhwbGljaXQgbGlzdCkgaW50byBhXG4gKiBkZXRlcm1pbmlzdGljLCBkZS1kdXBsaWNhdGVkIGxpc3Qgb2YgYWJzb2x1dGUgZGVmaW5pdGlvbiBmaWxlIHBhdGhzLlxuICogQHBhcmFtIHtzdHJpbmcgfCBzdHJpbmdbXX0gdGFyZ2V0IC0gRmlsZSBwYXRoLCBkaXJlY3RvcnksIG9yIGxpc3Qgb2YgcGF0aHMuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmdbXT59IC0gU29ydGVkLCBkZS1kdXBsaWNhdGVkIGFic29sdXRlIGZpbGUgcGF0aHMuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIHJlc29sdmVGaWxlcyh0YXJnZXQpIHtcbiAgaWYgKEFycmF5LmlzQXJyYXkodGFyZ2V0KSkge1xuICAgIHJldHVybiBbLi4ubmV3IFNldCh0YXJnZXQubWFwKChlbnRyeSkgPT4gcGF0aC5yZXNvbHZlKGVudHJ5KSkpXS5zb3J0KClcbiAgfVxuXG4gIGNvbnN0IHJlc29sdmVkID0gcGF0aC5yZXNvbHZlKHRhcmdldClcbiAgY29uc3Qgc3RhdHMgPSBhd2FpdCBzdGF0KHJlc29sdmVkKVxuXG4gIGlmIChzdGF0cy5pc0RpcmVjdG9yeSgpKSByZXR1cm4gYXdhaXQgY29sbGVjdERpcmVjdG9yeUZpbGVzKHJlc29sdmVkKVxuXG4gIHJldHVybiBbcmVzb2x2ZWRdXG59XG5cbi8qKlxuICogTG9hZHMgVmVsb2Npb3VzIGZhY3RvcnkgZGVmaW5pdGlvbiBmaWxlcyAoTm9kZSBvbmx5KS4gRWFjaCBmaWxlIG11c3RcbiAqIGRlZmF1bHQtZXhwb3J0IGEgYChyZWdpc3RyeSkgPT4gdm9pZGAgZnVuY3Rpb24gdGhhdCBkZWZpbmVzIGludG8gdGhlIHJlZ2lzdHJ5LlxuICogRmlsZXMgbG9hZCBpbiBkZXRlcm1pbmlzdGljIHBhdGggb3JkZXIuIFRoaXMgbW9kdWxlIGlzIGludGVudGlvbmFsbHkgTm9kZS1vbmx5XG4gKiAoZmlsZXN5c3RlbSArIGR5bmFtaWMgaW1wb3J0KSBhbmQgbXVzdCBuZXZlciBiZSBpbXBvcnRlZCBmcm9tIGJyb3dzZXIvTWV0cm9cbiAqIGJ1bmRsZXM7IGltcG9ydCB0aGUgYnJvd3Nlci1zYWZlIGNvcmUgZnJvbSBgLi4vaW5kZXguanNgIHRoZXJlIGluc3RlYWQuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2ZhY3RvcnktcmVnaXN0cnkuanNcIikuZGVmYXVsdH0gcmVnaXN0cnkgLSBSZWdpc3RyeSB0byBkZWZpbmUgaW50by5cbiAqIEBwYXJhbSB7c3RyaW5nIHwgc3RyaW5nW119IHRhcmdldCAtIEZpbGUgcGF0aCwgZGlyZWN0b3J5LCBvciBsaXN0IG9mIHBhdGhzLlxuICogQHBhcmFtIHt7cmVsb2FkPzogYm9vbGVhbn19IFtvcHRpb25zXSAtIE9wdGlvbnMuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmdbXT59IC0gVGhlIGxvYWRlZCBmaWxlIHBhdGhzLCBpbiBsb2FkIG9yZGVyLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gbG9hZERlZmluaXRpb25zKHJlZ2lzdHJ5LCB0YXJnZXQsIHtyZWxvYWQgPSBmYWxzZX0gPSB7fSkge1xuICBjb25zdCBmaWxlcyA9IGF3YWl0IHJlc29sdmVGaWxlcyh0YXJnZXQpXG5cbiAgcmV0dXJuIGF3YWl0IGxvYWRSZXNvbHZlZERlZmluaXRpb25GaWxlcyh7ZmlsZXMsIHJlZ2lzdHJ5LCByZWxvYWR9KVxufVxuXG4vKipcbiAqIExvYWRzIGRlZmluaXRpb24gZmlsZXMgdGhhdCBoYXZlIGFscmVhZHkgYmVlbiByZXNvbHZlZCBpbnRvIGEgZGV0ZXJtaW5pc3RpY1xuICogc29ydGVkIGxpc3QuIFdoZW4gYHJlbG9hZGAgaXMgc2V0LCB0aGUgd2hvbGUgYmF0Y2ggaXMgcHJlZmxpZ2h0ZWQgYW5kIHJlc2VydmVkXG4gKiBhZ2FpbnN0IHRoZSBwcm9jZXNzLWdsb2JhbCBpbXBvcnQgYnVkZ2V0IGJlZm9yZSBhbnkgcmVnaXN0cnkgcmVzZXQgb3IgaW1wb3J0XG4gKiBhdHRlbXB0LCBzbyBhIHJlamVjdGVkIHJlbG9hZCBuZXZlciBtdXRhdGVzIHRoZSByZWdpc3RyeS5cbiAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gKiBAcGFyYW0ge3N0cmluZ1tdfSBhcmdzLmZpbGVzIC0gUmVzb2x2ZWQsIHNvcnRlZCBkZWZpbml0aW9uIGZpbGUgcGF0aHMuXG4gKiBAcGFyYW0ge2ltcG9ydChcIi4uL2ZhY3RvcnktcmVnaXN0cnkuanNcIikuZGVmYXVsdH0gYXJncy5yZWdpc3RyeSAtIFJlZ2lzdHJ5IHRvIGRlZmluZSBpbnRvLlxuICogQHBhcmFtIHtib29sZWFufSBhcmdzLnJlbG9hZCAtIFdoZXRoZXIgdG8gY2FjaGUtYnVzdCB0aGUgaW1wb3J0cy5cbiAqIEBwYXJhbSB7Ym9vbGVhbn0gW2FyZ3MucmVzZXRdIC0gV2hldGhlciB0byByZXNldCB0aGUgcmVnaXN0cnkgZmlyc3QuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmdbXT59IC0gVGhlIGxvYWRlZCBmaWxlIHBhdGhzLCBpbiBsb2FkIG9yZGVyLlxuICovXG5hc3luYyBmdW5jdGlvbiBsb2FkUmVzb2x2ZWREZWZpbml0aW9uRmlsZXMoe2ZpbGVzLCByZWdpc3RyeSwgcmVsb2FkLCByZXNldCA9IGZhbHNlfSkge1xuICBpZiAocmVsb2FkKSByZXNlcnZlRGVmaW5pdGlvblJlbG9hZEJ1ZGdldChmaWxlcy5sZW5ndGgpXG5cbiAgaWYgKHJlc2V0KSByZWdpc3RyeS5yZXNldCgpXG5cbiAgZm9yIChjb25zdCBmaWxlIG9mIGZpbGVzKSB7XG4gICAgbGV0IGhyZWYgPSBwYXRoVG9GaWxlVVJMKGZpbGUpLmhyZWZcblxuICAgIGlmIChyZWxvYWQpIHtcbiAgICAgIHJlbG9hZENvdW50ZXIgKz0gMVxuICAgICAgaHJlZiArPSBgP2ZhY3RvcnlSZWxvYWQ9JHtyZWxvYWRDb3VudGVyfWBcbiAgICB9XG5cbiAgICBjb25zdCBtb2R1bGUgPSBhd2FpdCBpbXBvcnQoaHJlZilcblxuICAgIGlmICh0eXBlb2YgbW9kdWxlLmRlZmF1bHQgIT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBGYWN0b3J5IGRlZmluaXRpb24gZmlsZSAke2ZpbGV9IG11c3QgZGVmYXVsdC1leHBvcnQgYSAocmVnaXN0cnkpID0+IHZvaWQgZnVuY3Rpb25gKVxuICAgIH1cblxuICAgIG1vZHVsZS5kZWZhdWx0KHJlZ2lzdHJ5KVxuICB9XG5cbiAgcmV0dXJuIGZpbGVzXG59XG5cbi8qKlxuICogRnVsbHkgcmVsb2FkcyBkZWZpbml0aW9uczogcmVzZXRzIHRoZSByZWdpc3RyeSAoZHJvcHBpbmcgZXZlcnkgZmFjdG9yeSwgdHJhaXQsXG4gKiBzZXF1ZW5jZSwgY2FsbGJhY2sgYW5kIGRlZmF1bHQpIGFuZCByZS1pbXBvcnRzIHRoZSB0YXJnZXQgZmlsZXMgd2l0aCBjYWNoZVxuICogYnVzdGluZyBzbyBlZGl0ZWQgZGVmaW5pdGlvbnMgdGFrZSBlZmZlY3QuIFRoZSByZXNvbHZlZCBiYXRjaCBpcyBwcmVmbGlnaHRlZFxuICogYWdhaW5zdCB0aGUgcHJvY2Vzcy1nbG9iYWwgaW1wb3J0IGJ1ZGdldCBiZWZvcmUgdGhlIHJlc2V0LCBhbmQgYVxuICogYERlZmluaXRpb25SZWN5Y2xlUmVxdWlyZWRFcnJvcmAgaXMgcmFpc2VkIGJlZm9yZSBhbnkgbXV0YXRpb24gd2hlbiB0aGUgYmF0Y2hcbiAqIHdvdWxkIGV4Y2VlZCB0aGUgYnVkZ2V0LlxuICogQHBhcmFtIHtpbXBvcnQoXCIuLi9mYWN0b3J5LXJlZ2lzdHJ5LmpzXCIpLmRlZmF1bHR9IHJlZ2lzdHJ5IC0gUmVnaXN0cnkgdG8gcmVsb2FkLlxuICogQHBhcmFtIHtzdHJpbmcgfCBzdHJpbmdbXX0gdGFyZ2V0IC0gRmlsZSBwYXRoLCBkaXJlY3RvcnksIG9yIGxpc3Qgb2YgcGF0aHMuXG4gKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmdbXT59IC0gVGhlIHJlbG9hZGVkIGZpbGUgcGF0aHMsIGluIGxvYWQgb3JkZXIuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZWxvYWREZWZpbml0aW9ucyhyZWdpc3RyeSwgdGFyZ2V0KSB7XG4gIGNvbnN0IGZpbGVzID0gYXdhaXQgcmVzb2x2ZUZpbGVzKHRhcmdldClcblxuICByZXR1cm4gYXdhaXQgbG9hZFJlc29sdmVkRGVmaW5pdGlvbkZpbGVzKHtmaWxlcywgcmVnaXN0cnksIHJlbG9hZDogdHJ1ZSwgcmVzZXQ6IHRydWV9KVxufVxuIl19