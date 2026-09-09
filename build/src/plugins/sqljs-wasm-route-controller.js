import fs from "node:fs/promises";
import path from "node:path";
import Controller from "../controller.js";
/**
 * Runs valid asset file name.
 * @param {ReturnType<typeof JSON.parse>} assetFileName - Asset file name.
 * @returns {boolean} - Whether asset file name is safe.
 */
function validAssetFileName(assetFileName) {
    return typeof assetFileName === "string"
        && assetFileName.length > 0
        && !assetFileName.includes("/")
        && !assetFileName.includes("\\")
        && !assetFileName.includes("..");
}
/**
 * Runs normalize sql js asset file name.
 * @param {string} assetFileName - Requested sql.js asset file name.
 * @returns {string} - Normalized sql.js asset file name.
 */
function normalizeSqlJsAssetFileName(assetFileName) {
    if (assetFileName === "sql-wasm-browser.wasm") {
        return "sql-wasm.wasm";
    }
    return assetFileName;
}
/** Serves sql.js assets from the backend for sqlite-web locateFile callbacks. */
export default class SqlJsWasmRouteController extends Controller {
    /**
     * Runs show.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async show() {
        const { sqlJsAssetFileName, sqlJsDistDirectory } = this.params();
        if (!validAssetFileName(sqlJsAssetFileName)) {
            throw new Error(`Invalid sql.js asset file name: ${String(sqlJsAssetFileName)}`);
        }
        if (typeof sqlJsDistDirectory !== "string" || sqlJsDistDirectory.length < 1) {
            throw new Error(`Expected sql.js dist directory path to be a string, got: ${String(sqlJsDistDirectory)}`);
        }
        const normalizedSqlJsAssetFileName = normalizeSqlJsAssetFileName(sqlJsAssetFileName);
        const assetPath = path.join(sqlJsDistDirectory, normalizedSqlJsAssetFileName);
        try {
            await fs.access(assetPath);
        }
        catch (error) {
            const ensuredError = /** @type {{code?: string}} */ (error);
            if (ensuredError.code === "ENOENT") {
                await this.render({ json: { errorMessage: "Not found", status: "error" }, status: "not-found" });
                return;
            }
            throw error;
        }
        this.response().setHeader("Cache-Control", "public, max-age=3600");
        this.sendFile(assetPath);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic3FsanMtd2FzbS1yb3V0ZS1jb250cm9sbGVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL3BsdWdpbnMvc3FsanMtd2FzbS1yb3V0ZS1jb250cm9sbGVyLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLE9BQU8sRUFBRSxNQUFNLGtCQUFrQixDQUFBO0FBQ2pDLE9BQU8sSUFBSSxNQUFNLFdBQVcsQ0FBQTtBQUU1QixPQUFPLFVBQVUsTUFBTSxrQkFBa0IsQ0FBQTtBQUV6Qzs7OztHQUlHO0FBQ0gsU0FBUyxrQkFBa0IsQ0FBQyxhQUFhO0lBQ3ZDLE9BQU8sT0FBTyxhQUFhLEtBQUssUUFBUTtXQUNuQyxhQUFhLENBQUMsTUFBTSxHQUFHLENBQUM7V0FDeEIsQ0FBQyxhQUFhLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQztXQUM1QixDQUFDLGFBQWEsQ0FBQyxRQUFRLENBQUMsSUFBSSxDQUFDO1dBQzdCLENBQUMsYUFBYSxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsQ0FBQTtBQUNwQyxDQUFDO0FBRUQ7Ozs7R0FJRztBQUNILFNBQVMsMkJBQTJCLENBQUMsYUFBYTtJQUNoRCxJQUFJLGFBQWEsS0FBSyx1QkFBdUIsRUFBRSxDQUFDO1FBQzlDLE9BQU8sZUFBZSxDQUFBO0lBQ3hCLENBQUM7SUFFRCxPQUFPLGFBQWEsQ0FBQTtBQUN0QixDQUFDO0FBRUQsaUZBQWlGO0FBQ2pGLE1BQU0sQ0FBQyxPQUFPLE9BQU8sd0JBQXlCLFNBQVEsVUFBVTtJQUM5RDs7O09BR0c7SUFDSCxLQUFLLENBQUMsSUFBSTtRQUNSLE1BQU0sRUFBQyxrQkFBa0IsRUFBRSxrQkFBa0IsRUFBQyxHQUFHLElBQUksQ0FBQyxNQUFNLEVBQUUsQ0FBQTtRQUU5RCxJQUFJLENBQUMsa0JBQWtCLENBQUMsa0JBQWtCLENBQUMsRUFBRSxDQUFDO1lBQzVDLE1BQU0sSUFBSSxLQUFLLENBQUMsbUNBQW1DLE1BQU0sQ0FBQyxrQkFBa0IsQ0FBQyxFQUFFLENBQUMsQ0FBQTtRQUNsRixDQUFDO1FBRUQsSUFBSSxPQUFPLGtCQUFrQixLQUFLLFFBQVEsSUFBSSxrQkFBa0IsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxFQUFFLENBQUM7WUFDNUUsTUFBTSxJQUFJLEtBQUssQ0FBQyw0REFBNEQsTUFBTSxDQUFDLGtCQUFrQixDQUFDLEVBQUUsQ0FBQyxDQUFBO1FBQzNHLENBQUM7UUFFRCxNQUFNLDRCQUE0QixHQUFHLDJCQUEyQixDQUFDLGtCQUFrQixDQUFDLENBQUE7UUFDcEYsTUFBTSxTQUFTLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxrQkFBa0IsRUFBRSw0QkFBNEIsQ0FBQyxDQUFBO1FBRTdFLElBQUksQ0FBQztZQUNILE1BQU0sRUFBRSxDQUFDLE1BQU0sQ0FBQyxTQUFTLENBQUMsQ0FBQTtRQUM1QixDQUFDO1FBQUMsT0FBTyxLQUFLLEVBQUUsQ0FBQztZQUNmLE1BQU0sWUFBWSxHQUFHLDhCQUE4QixDQUFDLENBQUMsS0FBSyxDQUFDLENBQUE7WUFFM0QsSUFBSSxZQUFZLENBQUMsSUFBSSxLQUFLLFFBQVEsRUFBRSxDQUFDO2dCQUNuQyxNQUFNLElBQUksQ0FBQyxNQUFNLENBQUMsRUFBQyxJQUFJLEVBQUUsRUFBQyxZQUFZLEVBQUUsV0FBVyxFQUFFLE1BQU0sRUFBRSxPQUFPLEVBQUMsRUFBRSxNQUFNLEVBQUUsV0FBVyxFQUFDLENBQUMsQ0FBQTtnQkFDNUYsT0FBTTtZQUNSLENBQUM7WUFFRCxNQUFNLEtBQUssQ0FBQTtRQUNiLENBQUM7UUFFRCxJQUFJLENBQUMsUUFBUSxFQUFFLENBQUMsU0FBUyxDQUFDLGVBQWUsRUFBRSxzQkFBc0IsQ0FBQyxDQUFBO1FBQ2xFLElBQUksQ0FBQyxRQUFRLENBQUMsU0FBUyxDQUFDLENBQUE7SUFDMUIsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IGZzIGZyb20gXCJub2RlOmZzL3Byb21pc2VzXCJcbmltcG9ydCBwYXRoIGZyb20gXCJub2RlOnBhdGhcIlxuXG5pbXBvcnQgQ29udHJvbGxlciBmcm9tIFwiLi4vY29udHJvbGxlci5qc1wiXG5cbi8qKlxuICogUnVucyB2YWxpZCBhc3NldCBmaWxlIG5hbWUuXG4gKiBAcGFyYW0ge1JldHVyblR5cGU8dHlwZW9mIEpTT04ucGFyc2U+fSBhc3NldEZpbGVOYW1lIC0gQXNzZXQgZmlsZSBuYW1lLlxuICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciBhc3NldCBmaWxlIG5hbWUgaXMgc2FmZS5cbiAqL1xuZnVuY3Rpb24gdmFsaWRBc3NldEZpbGVOYW1lKGFzc2V0RmlsZU5hbWUpIHtcbiAgcmV0dXJuIHR5cGVvZiBhc3NldEZpbGVOYW1lID09PSBcInN0cmluZ1wiXG4gICAgJiYgYXNzZXRGaWxlTmFtZS5sZW5ndGggPiAwXG4gICAgJiYgIWFzc2V0RmlsZU5hbWUuaW5jbHVkZXMoXCIvXCIpXG4gICAgJiYgIWFzc2V0RmlsZU5hbWUuaW5jbHVkZXMoXCJcXFxcXCIpXG4gICAgJiYgIWFzc2V0RmlsZU5hbWUuaW5jbHVkZXMoXCIuLlwiKVxufVxuXG4vKipcbiAqIFJ1bnMgbm9ybWFsaXplIHNxbCBqcyBhc3NldCBmaWxlIG5hbWUuXG4gKiBAcGFyYW0ge3N0cmluZ30gYXNzZXRGaWxlTmFtZSAtIFJlcXVlc3RlZCBzcWwuanMgYXNzZXQgZmlsZSBuYW1lLlxuICogQHJldHVybnMge3N0cmluZ30gLSBOb3JtYWxpemVkIHNxbC5qcyBhc3NldCBmaWxlIG5hbWUuXG4gKi9cbmZ1bmN0aW9uIG5vcm1hbGl6ZVNxbEpzQXNzZXRGaWxlTmFtZShhc3NldEZpbGVOYW1lKSB7XG4gIGlmIChhc3NldEZpbGVOYW1lID09PSBcInNxbC13YXNtLWJyb3dzZXIud2FzbVwiKSB7XG4gICAgcmV0dXJuIFwic3FsLXdhc20ud2FzbVwiXG4gIH1cblxuICByZXR1cm4gYXNzZXRGaWxlTmFtZVxufVxuXG4vKiogU2VydmVzIHNxbC5qcyBhc3NldHMgZnJvbSB0aGUgYmFja2VuZCBmb3Igc3FsaXRlLXdlYiBsb2NhdGVGaWxlIGNhbGxiYWNrcy4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFNxbEpzV2FzbVJvdXRlQ29udHJvbGxlciBleHRlbmRzIENvbnRyb2xsZXIge1xuICAvKipcbiAgICogUnVucyBzaG93LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNvbXBsZXRlLlxuICAgKi9cbiAgYXN5bmMgc2hvdygpIHtcbiAgICBjb25zdCB7c3FsSnNBc3NldEZpbGVOYW1lLCBzcWxKc0Rpc3REaXJlY3Rvcnl9ID0gdGhpcy5wYXJhbXMoKVxuXG4gICAgaWYgKCF2YWxpZEFzc2V0RmlsZU5hbWUoc3FsSnNBc3NldEZpbGVOYW1lKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBJbnZhbGlkIHNxbC5qcyBhc3NldCBmaWxlIG5hbWU6ICR7U3RyaW5nKHNxbEpzQXNzZXRGaWxlTmFtZSl9YClcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIHNxbEpzRGlzdERpcmVjdG9yeSAhPT0gXCJzdHJpbmdcIiB8fCBzcWxKc0Rpc3REaXJlY3RvcnkubGVuZ3RoIDwgMSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBFeHBlY3RlZCBzcWwuanMgZGlzdCBkaXJlY3RvcnkgcGF0aCB0byBiZSBhIHN0cmluZywgZ290OiAke1N0cmluZyhzcWxKc0Rpc3REaXJlY3RvcnkpfWApXG4gICAgfVxuXG4gICAgY29uc3Qgbm9ybWFsaXplZFNxbEpzQXNzZXRGaWxlTmFtZSA9IG5vcm1hbGl6ZVNxbEpzQXNzZXRGaWxlTmFtZShzcWxKc0Fzc2V0RmlsZU5hbWUpXG4gICAgY29uc3QgYXNzZXRQYXRoID0gcGF0aC5qb2luKHNxbEpzRGlzdERpcmVjdG9yeSwgbm9ybWFsaXplZFNxbEpzQXNzZXRGaWxlTmFtZSlcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBmcy5hY2Nlc3MoYXNzZXRQYXRoKVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBjb25zdCBlbnN1cmVkRXJyb3IgPSAvKiogQHR5cGUge3tjb2RlPzogc3RyaW5nfX0gKi8gKGVycm9yKVxuXG4gICAgICBpZiAoZW5zdXJlZEVycm9yLmNvZGUgPT09IFwiRU5PRU5UXCIpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5yZW5kZXIoe2pzb246IHtlcnJvck1lc3NhZ2U6IFwiTm90IGZvdW5kXCIsIHN0YXR1czogXCJlcnJvclwifSwgc3RhdHVzOiBcIm5vdC1mb3VuZFwifSlcbiAgICAgICAgcmV0dXJuXG4gICAgICB9XG5cbiAgICAgIHRocm93IGVycm9yXG4gICAgfVxuXG4gICAgdGhpcy5yZXNwb25zZSgpLnNldEhlYWRlcihcIkNhY2hlLUNvbnRyb2xcIiwgXCJwdWJsaWMsIG1heC1hZ2U9MzYwMFwiKVxuICAgIHRoaXMuc2VuZEZpbGUoYXNzZXRQYXRoKVxuICB9XG59XG4iXX0=