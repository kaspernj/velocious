// @ts-check
import path from "path";
import { pathToFileURL } from "url";
/**
 * Runs is windows absolute path.
 * @param {string} value - Path or import specifier.
 * @returns {boolean} - Whether value is a Windows absolute path.
 */
function isWindowsAbsolutePath(value) {
    return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("\\\\");
}
/**
 * Runs windows path to file url.
 * @param {string} windowsPath - Windows absolute path.
 * @returns {string} - File URL.
 */
function windowsPathToFileUrl(windowsPath) {
    const normalized = windowsPath.replaceAll("\\", "/");
    if (normalized.startsWith("//")) {
        const uncPath = normalized.replace(/^\/+/, "");
        const [host, ...pathParts] = uncPath.split("/");
        const url = new URL(`file://${host}/`);
        url.pathname = `/${pathParts.join("/")}`;
        return url.href;
    }
    const url = new URL("file:///");
    url.pathname = `/${normalized}`;
    return url.href;
}
/**
 * Converts a filesystem path to a dynamic-import safe specifier across platforms.
 * Leaves package names and relative specifiers unchanged.
 * @param {string} value - Import specifier or filesystem path.
 * @returns {string} - Import specifier safe for dynamic import.
 */
export default function toImportSpecifier(value) {
    if (value.match(/^(node|data|file):/))
        return value;
    if (value.startsWith("./") || value.startsWith("../"))
        return value;
    if (isWindowsAbsolutePath(value))
        return windowsPathToFileUrl(value);
    if (path.isAbsolute(value))
        return pathToFileURL(value).href;
    return value;
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidG8taW1wb3J0LXNwZWNpZmllci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy91dGlscy90by1pbXBvcnQtc3BlY2lmaWVyLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBLFlBQVk7QUFFWixPQUFPLElBQUksTUFBTSxNQUFNLENBQUE7QUFDdkIsT0FBTyxFQUFDLGFBQWEsRUFBQyxNQUFNLEtBQUssQ0FBQTtBQUVqQzs7OztHQUlHO0FBQ0gsU0FBUyxxQkFBcUIsQ0FBQyxLQUFLO0lBQ2xDLE9BQU8saUJBQWlCLENBQUMsSUFBSSxDQUFDLEtBQUssQ0FBQyxJQUFJLEtBQUssQ0FBQyxVQUFVLENBQUMsTUFBTSxDQUFDLENBQUE7QUFDbEUsQ0FBQztBQUVEOzs7O0dBSUc7QUFDSCxTQUFTLG9CQUFvQixDQUFDLFdBQVc7SUFDdkMsTUFBTSxVQUFVLEdBQUcsV0FBVyxDQUFDLFVBQVUsQ0FBQyxJQUFJLEVBQUUsR0FBRyxDQUFDLENBQUE7SUFFcEQsSUFBSSxVQUFVLENBQUMsVUFBVSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUM7UUFDaEMsTUFBTSxPQUFPLEdBQUcsVUFBVSxDQUFDLE9BQU8sQ0FBQyxNQUFNLEVBQUUsRUFBRSxDQUFDLENBQUE7UUFDOUMsTUFBTSxDQUFDLElBQUksRUFBRSxHQUFHLFNBQVMsQ0FBQyxHQUFHLE9BQU8sQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUE7UUFDL0MsTUFBTSxHQUFHLEdBQUcsSUFBSSxHQUFHLENBQUMsVUFBVSxJQUFJLEdBQUcsQ0FBQyxDQUFBO1FBRXRDLEdBQUcsQ0FBQyxRQUFRLEdBQUcsSUFBSSxTQUFTLENBQUMsSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUE7UUFFeEMsT0FBTyxHQUFHLENBQUMsSUFBSSxDQUFBO0lBQ2pCLENBQUM7SUFFRCxNQUFNLEdBQUcsR0FBRyxJQUFJLEdBQUcsQ0FBQyxVQUFVLENBQUMsQ0FBQTtJQUUvQixHQUFHLENBQUMsUUFBUSxHQUFHLElBQUksVUFBVSxFQUFFLENBQUE7SUFFL0IsT0FBTyxHQUFHLENBQUMsSUFBSSxDQUFBO0FBQ2pCLENBQUM7QUFFRDs7Ozs7R0FLRztBQUNILE1BQU0sQ0FBQyxPQUFPLFVBQVUsaUJBQWlCLENBQUMsS0FBSztJQUM3QyxJQUFJLEtBQUssQ0FBQyxLQUFLLENBQUMsb0JBQW9CLENBQUM7UUFBRSxPQUFPLEtBQUssQ0FBQTtJQUNuRCxJQUFJLEtBQUssQ0FBQyxVQUFVLENBQUMsSUFBSSxDQUFDLElBQUksS0FBSyxDQUFDLFVBQVUsQ0FBQyxLQUFLLENBQUM7UUFBRSxPQUFPLEtBQUssQ0FBQTtJQUNuRSxJQUFJLHFCQUFxQixDQUFDLEtBQUssQ0FBQztRQUFFLE9BQU8sb0JBQW9CLENBQUMsS0FBSyxDQUFDLENBQUE7SUFDcEUsSUFBSSxJQUFJLENBQUMsVUFBVSxDQUFDLEtBQUssQ0FBQztRQUFFLE9BQU8sYUFBYSxDQUFDLEtBQUssQ0FBQyxDQUFDLElBQUksQ0FBQTtJQUU1RCxPQUFPLEtBQUssQ0FBQTtBQUNkLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHBhdGggZnJvbSBcInBhdGhcIlxuaW1wb3J0IHtwYXRoVG9GaWxlVVJMfSBmcm9tIFwidXJsXCJcblxuLyoqXG4gKiBSdW5zIGlzIHdpbmRvd3MgYWJzb2x1dGUgcGF0aC5cbiAqIEBwYXJhbSB7c3RyaW5nfSB2YWx1ZSAtIFBhdGggb3IgaW1wb3J0IHNwZWNpZmllci5cbiAqIEByZXR1cm5zIHtib29sZWFufSAtIFdoZXRoZXIgdmFsdWUgaXMgYSBXaW5kb3dzIGFic29sdXRlIHBhdGguXG4gKi9cbmZ1bmN0aW9uIGlzV2luZG93c0Fic29sdXRlUGF0aCh2YWx1ZSkge1xuICByZXR1cm4gL15bYS16QS1aXTpbXFxcXC9dLy50ZXN0KHZhbHVlKSB8fCB2YWx1ZS5zdGFydHNXaXRoKFwiXFxcXFxcXFxcIilcbn1cblxuLyoqXG4gKiBSdW5zIHdpbmRvd3MgcGF0aCB0byBmaWxlIHVybC5cbiAqIEBwYXJhbSB7c3RyaW5nfSB3aW5kb3dzUGF0aCAtIFdpbmRvd3MgYWJzb2x1dGUgcGF0aC5cbiAqIEByZXR1cm5zIHtzdHJpbmd9IC0gRmlsZSBVUkwuXG4gKi9cbmZ1bmN0aW9uIHdpbmRvd3NQYXRoVG9GaWxlVXJsKHdpbmRvd3NQYXRoKSB7XG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSB3aW5kb3dzUGF0aC5yZXBsYWNlQWxsKFwiXFxcXFwiLCBcIi9cIilcblxuICBpZiAobm9ybWFsaXplZC5zdGFydHNXaXRoKFwiLy9cIikpIHtcbiAgICBjb25zdCB1bmNQYXRoID0gbm9ybWFsaXplZC5yZXBsYWNlKC9eXFwvKy8sIFwiXCIpXG4gICAgY29uc3QgW2hvc3QsIC4uLnBhdGhQYXJ0c10gPSB1bmNQYXRoLnNwbGl0KFwiL1wiKVxuICAgIGNvbnN0IHVybCA9IG5ldyBVUkwoYGZpbGU6Ly8ke2hvc3R9L2ApXG5cbiAgICB1cmwucGF0aG5hbWUgPSBgLyR7cGF0aFBhcnRzLmpvaW4oXCIvXCIpfWBcblxuICAgIHJldHVybiB1cmwuaHJlZlxuICB9XG5cbiAgY29uc3QgdXJsID0gbmV3IFVSTChcImZpbGU6Ly8vXCIpXG5cbiAgdXJsLnBhdGhuYW1lID0gYC8ke25vcm1hbGl6ZWR9YFxuXG4gIHJldHVybiB1cmwuaHJlZlxufVxuXG4vKipcbiAqIENvbnZlcnRzIGEgZmlsZXN5c3RlbSBwYXRoIHRvIGEgZHluYW1pYy1pbXBvcnQgc2FmZSBzcGVjaWZpZXIgYWNyb3NzIHBsYXRmb3Jtcy5cbiAqIExlYXZlcyBwYWNrYWdlIG5hbWVzIGFuZCByZWxhdGl2ZSBzcGVjaWZpZXJzIHVuY2hhbmdlZC5cbiAqIEBwYXJhbSB7c3RyaW5nfSB2YWx1ZSAtIEltcG9ydCBzcGVjaWZpZXIgb3IgZmlsZXN5c3RlbSBwYXRoLlxuICogQHJldHVybnMge3N0cmluZ30gLSBJbXBvcnQgc3BlY2lmaWVyIHNhZmUgZm9yIGR5bmFtaWMgaW1wb3J0LlxuICovXG5leHBvcnQgZGVmYXVsdCBmdW5jdGlvbiB0b0ltcG9ydFNwZWNpZmllcih2YWx1ZSkge1xuICBpZiAodmFsdWUubWF0Y2goL14obm9kZXxkYXRhfGZpbGUpOi8pKSByZXR1cm4gdmFsdWVcbiAgaWYgKHZhbHVlLnN0YXJ0c1dpdGgoXCIuL1wiKSB8fCB2YWx1ZS5zdGFydHNXaXRoKFwiLi4vXCIpKSByZXR1cm4gdmFsdWVcbiAgaWYgKGlzV2luZG93c0Fic29sdXRlUGF0aCh2YWx1ZSkpIHJldHVybiB3aW5kb3dzUGF0aFRvRmlsZVVybCh2YWx1ZSlcbiAgaWYgKHBhdGguaXNBYnNvbHV0ZSh2YWx1ZSkpIHJldHVybiBwYXRoVG9GaWxlVVJMKHZhbHVlKS5ocmVmXG5cbiAgcmV0dXJuIHZhbHVlXG59XG4iXX0=