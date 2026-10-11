// @ts-check
import fs from "node:fs/promises";
import path from "node:path";
/**
 * Serves a static file from `root` directory to the response as a
 * length-determined body (no chunked transfer-encoding).
 *
 * This is the proxy-safe alternative to `response.setFilePath()` /
 * `response.stream()`: the file is read into memory and sent with an
 * explicit `Content-Length` header, which avoids issues with proxies
 * (e.g. Rollbridge) that do not support chunked transfer encoding.
 * @param {import("./response.js").default} response
 *   The HTTP response to write to.
 * @param {string} root - Absolute directory path that files must live under.
 * @param {string} name - File name (or relative path) to serve from within `root`.
 * @param {object} [options] - Serving options.
 * @param {string} [options.contentType] - MIME type to set on the response.
 * @param {string} [options.cacheControl] - Value for the `Cache-Control` header.
 * @returns {Promise<boolean>} - `true` if the file was served, `false` if the
 *   file was not found or the name resolved outside the root (404 set in both cases).
 */
export default async function serveFile(response, root, name, options = {}) {
    const { contentType, cacheControl } = options;
    // Reject empty or null names.
    if (!name || typeof name !== "string") {
        response.setStatus(404);
        return false;
    }
    // Resolve the target path and verify it stays within root.
    const resolvedRoot = path.resolve(root);
    const targetPath = path.resolve(resolvedRoot, name);
    // Path containment check: the resolved target must be inside root.
    if (targetPath !== resolvedRoot && !targetPath.startsWith(resolvedRoot + path.sep)) {
        response.setStatus(404);
        return false;
    }
    // lstat to reject symlinks and confirm the path is a regular file.
    let stat;
    try {
        stat = await fs.lstat(targetPath);
    }
    catch {
        response.setStatus(404);
        return false;
    }
    if (!stat.isFile() || stat.isSymbolicLink()) {
        response.setStatus(404);
        return false;
    }
    const data = await fs.readFile(targetPath);
    response.setBody(data);
    response.setHeader("Content-Type", contentType || "application/octet-stream");
    response.setHeader("Cache-Control", cacheControl || "no-store");
    return true;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VydmUtZmlsZS5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3NyYy9odHRwLXNlcnZlci9jbGllbnQvc2VydmUtZmlsZS5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQSxZQUFZO0FBRVosT0FBTyxFQUFFLE1BQU0sa0JBQWtCLENBQUE7QUFDakMsT0FBTyxJQUFJLE1BQU0sV0FBVyxDQUFBO0FBRTVCOzs7Ozs7Ozs7Ozs7Ozs7OztHQWlCRztBQUNILE1BQU0sQ0FBQyxPQUFPLENBQUMsS0FBSyxVQUFVLFNBQVMsQ0FBQyxRQUFRLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxPQUFPLEdBQUcsRUFBRTtJQUN4RSxNQUFNLEVBQUMsV0FBVyxFQUFFLFlBQVksRUFBQyxHQUFHLE9BQU8sQ0FBQTtJQUUzQyw4QkFBOEI7SUFDOUIsSUFBSSxDQUFDLElBQUksSUFBSSxPQUFPLElBQUksS0FBSyxRQUFRLEVBQUUsQ0FBQztRQUN0QyxRQUFRLENBQUMsU0FBUyxDQUFDLEdBQUcsQ0FBQyxDQUFBO1FBQ3ZCLE9BQU8sS0FBSyxDQUFBO0lBQ2QsQ0FBQztJQUVELDJEQUEyRDtJQUMzRCxNQUFNLFlBQVksR0FBRyxJQUFJLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxDQUFBO0lBQ3ZDLE1BQU0sVUFBVSxHQUFHLElBQUksQ0FBQyxPQUFPLENBQUMsWUFBWSxFQUFFLElBQUksQ0FBQyxDQUFBO0lBRW5ELG1FQUFtRTtJQUNuRSxJQUFJLFVBQVUsS0FBSyxZQUFZLElBQUksQ0FBQyxVQUFVLENBQUMsVUFBVSxDQUFDLFlBQVksR0FBRyxJQUFJLENBQUMsR0FBRyxDQUFDLEVBQUUsQ0FBQztRQUNuRixRQUFRLENBQUMsU0FBUyxDQUFDLEdBQUcsQ0FBQyxDQUFBO1FBQ3ZCLE9BQU8sS0FBSyxDQUFBO0lBQ2QsQ0FBQztJQUVELG1FQUFtRTtJQUNuRSxJQUFJLElBQUksQ0FBQTtJQUNSLElBQUksQ0FBQztRQUNILElBQUksR0FBRyxNQUFNLEVBQUUsQ0FBQyxLQUFLLENBQUMsVUFBVSxDQUFDLENBQUE7SUFDbkMsQ0FBQztJQUFDLE1BQU0sQ0FBQztRQUNQLFFBQVEsQ0FBQyxTQUFTLENBQUMsR0FBRyxDQUFDLENBQUE7UUFDdkIsT0FBTyxLQUFLLENBQUE7SUFDZCxDQUFDO0lBRUQsSUFBSSxDQUFDLElBQUksQ0FBQyxNQUFNLEVBQUUsSUFBSSxJQUFJLENBQUMsY0FBYyxFQUFFLEVBQUUsQ0FBQztRQUM1QyxRQUFRLENBQUMsU0FBUyxDQUFDLEdBQUcsQ0FBQyxDQUFBO1FBQ3ZCLE9BQU8sS0FBSyxDQUFBO0lBQ2QsQ0FBQztJQUVELE1BQU0sSUFBSSxHQUFHLE1BQU0sRUFBRSxDQUFDLFFBQVEsQ0FBQyxVQUFVLENBQUMsQ0FBQTtJQUUxQyxRQUFRLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBQyxDQUFBO0lBQ3RCLFFBQVEsQ0FBQyxTQUFTLENBQUMsY0FBYyxFQUFFLFdBQVcsSUFBSSwwQkFBMEIsQ0FBQyxDQUFBO0lBQzdFLFFBQVEsQ0FBQyxTQUFTLENBQUMsZUFBZSxFQUFFLFlBQVksSUFBSSxVQUFVLENBQUMsQ0FBQTtJQUUvRCxPQUFPLElBQUksQ0FBQTtBQUNiLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IGZzIGZyb20gXCJub2RlOmZzL3Byb21pc2VzXCJcbmltcG9ydCBwYXRoIGZyb20gXCJub2RlOnBhdGhcIlxuXG4vKipcbiAqIFNlcnZlcyBhIHN0YXRpYyBmaWxlIGZyb20gYHJvb3RgIGRpcmVjdG9yeSB0byB0aGUgcmVzcG9uc2UgYXMgYVxuICogbGVuZ3RoLWRldGVybWluZWQgYm9keSAobm8gY2h1bmtlZCB0cmFuc2Zlci1lbmNvZGluZykuXG4gKlxuICogVGhpcyBpcyB0aGUgcHJveHktc2FmZSBhbHRlcm5hdGl2ZSB0byBgcmVzcG9uc2Uuc2V0RmlsZVBhdGgoKWAgL1xuICogYHJlc3BvbnNlLnN0cmVhbSgpYDogdGhlIGZpbGUgaXMgcmVhZCBpbnRvIG1lbW9yeSBhbmQgc2VudCB3aXRoIGFuXG4gKiBleHBsaWNpdCBgQ29udGVudC1MZW5ndGhgIGhlYWRlciwgd2hpY2ggYXZvaWRzIGlzc3VlcyB3aXRoIHByb3hpZXNcbiAqIChlLmcuIFJvbGxicmlkZ2UpIHRoYXQgZG8gbm90IHN1cHBvcnQgY2h1bmtlZCB0cmFuc2ZlciBlbmNvZGluZy5cbiAqIEBwYXJhbSB7aW1wb3J0KFwiLi9yZXNwb25zZS5qc1wiKS5kZWZhdWx0fSByZXNwb25zZVxuICogICBUaGUgSFRUUCByZXNwb25zZSB0byB3cml0ZSB0by5cbiAqIEBwYXJhbSB7c3RyaW5nfSByb290IC0gQWJzb2x1dGUgZGlyZWN0b3J5IHBhdGggdGhhdCBmaWxlcyBtdXN0IGxpdmUgdW5kZXIuXG4gKiBAcGFyYW0ge3N0cmluZ30gbmFtZSAtIEZpbGUgbmFtZSAob3IgcmVsYXRpdmUgcGF0aCkgdG8gc2VydmUgZnJvbSB3aXRoaW4gYHJvb3RgLlxuICogQHBhcmFtIHtvYmplY3R9IFtvcHRpb25zXSAtIFNlcnZpbmcgb3B0aW9ucy5cbiAqIEBwYXJhbSB7c3RyaW5nfSBbb3B0aW9ucy5jb250ZW50VHlwZV0gLSBNSU1FIHR5cGUgdG8gc2V0IG9uIHRoZSByZXNwb25zZS5cbiAqIEBwYXJhbSB7c3RyaW5nfSBbb3B0aW9ucy5jYWNoZUNvbnRyb2xdIC0gVmFsdWUgZm9yIHRoZSBgQ2FjaGUtQ29udHJvbGAgaGVhZGVyLlxuICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IC0gYHRydWVgIGlmIHRoZSBmaWxlIHdhcyBzZXJ2ZWQsIGBmYWxzZWAgaWYgdGhlXG4gKiAgIGZpbGUgd2FzIG5vdCBmb3VuZCBvciB0aGUgbmFtZSByZXNvbHZlZCBvdXRzaWRlIHRoZSByb290ICg0MDQgc2V0IGluIGJvdGggY2FzZXMpLlxuICovXG5leHBvcnQgZGVmYXVsdCBhc3luYyBmdW5jdGlvbiBzZXJ2ZUZpbGUocmVzcG9uc2UsIHJvb3QsIG5hbWUsIG9wdGlvbnMgPSB7fSkge1xuICBjb25zdCB7Y29udGVudFR5cGUsIGNhY2hlQ29udHJvbH0gPSBvcHRpb25zXG5cbiAgLy8gUmVqZWN0IGVtcHR5IG9yIG51bGwgbmFtZXMuXG4gIGlmICghbmFtZSB8fCB0eXBlb2YgbmFtZSAhPT0gXCJzdHJpbmdcIikge1xuICAgIHJlc3BvbnNlLnNldFN0YXR1cyg0MDQpXG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICAvLyBSZXNvbHZlIHRoZSB0YXJnZXQgcGF0aCBhbmQgdmVyaWZ5IGl0IHN0YXlzIHdpdGhpbiByb290LlxuICBjb25zdCByZXNvbHZlZFJvb3QgPSBwYXRoLnJlc29sdmUocm9vdClcbiAgY29uc3QgdGFyZ2V0UGF0aCA9IHBhdGgucmVzb2x2ZShyZXNvbHZlZFJvb3QsIG5hbWUpXG5cbiAgLy8gUGF0aCBjb250YWlubWVudCBjaGVjazogdGhlIHJlc29sdmVkIHRhcmdldCBtdXN0IGJlIGluc2lkZSByb290LlxuICBpZiAodGFyZ2V0UGF0aCAhPT0gcmVzb2x2ZWRSb290ICYmICF0YXJnZXRQYXRoLnN0YXJ0c1dpdGgocmVzb2x2ZWRSb290ICsgcGF0aC5zZXApKSB7XG4gICAgcmVzcG9uc2Uuc2V0U3RhdHVzKDQwNClcbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIC8vIGxzdGF0IHRvIHJlamVjdCBzeW1saW5rcyBhbmQgY29uZmlybSB0aGUgcGF0aCBpcyBhIHJlZ3VsYXIgZmlsZS5cbiAgbGV0IHN0YXRcbiAgdHJ5IHtcbiAgICBzdGF0ID0gYXdhaXQgZnMubHN0YXQodGFyZ2V0UGF0aClcbiAgfSBjYXRjaCB7XG4gICAgcmVzcG9uc2Uuc2V0U3RhdHVzKDQwNClcbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIGlmICghc3RhdC5pc0ZpbGUoKSB8fCBzdGF0LmlzU3ltYm9saWNMaW5rKCkpIHtcbiAgICByZXNwb25zZS5zZXRTdGF0dXMoNDA0KVxuICAgIHJldHVybiBmYWxzZVxuICB9XG5cbiAgY29uc3QgZGF0YSA9IGF3YWl0IGZzLnJlYWRGaWxlKHRhcmdldFBhdGgpXG5cbiAgcmVzcG9uc2Uuc2V0Qm9keShkYXRhKVxuICByZXNwb25zZS5zZXRIZWFkZXIoXCJDb250ZW50LVR5cGVcIiwgY29udGVudFR5cGUgfHwgXCJhcHBsaWNhdGlvbi9vY3RldC1zdHJlYW1cIilcbiAgcmVzcG9uc2Uuc2V0SGVhZGVyKFwiQ2FjaGUtQ29udHJvbFwiLCBjYWNoZUNvbnRyb2wgfHwgXCJuby1zdG9yZVwiKVxuXG4gIHJldHVybiB0cnVlXG59XG4iXX0=