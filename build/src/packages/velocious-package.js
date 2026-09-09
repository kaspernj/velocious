// @ts-check
import restArgsError from "../utils/rest-args-error.js";
/**
 * A Velocious package (engine): an external npm package that contributes data
 * models, frontend-model resources and migrations to a consuming app. The app
 * lists packages in `Configuration({packages: [...]})`; the framework then loads
 * the package's `src/models`, discovers its `src/resources`, runs its
 * `src/database/migrations`, and generates its frontend models into the app.
 */
export default class VelociousPackage {
    /**
     * Wraps a plain descriptor as a VelociousPackage (or returns it unchanged when
     * it already is one), so packages can be listed without importing this class.
     * @param {VelociousPackage | import("../configuration-types.js").VelociousPackageDescriptor} descriptor - Package or plain descriptor.
     * @returns {VelociousPackage} - The package instance.
     */
    static from(descriptor) {
        if (descriptor instanceof VelociousPackage) {
            return descriptor;
        }
        return new VelociousPackage(descriptor);
    }
    /**
     * Derives the containing directory of a module url without Node's `path`/`url`
     * modules, so this class stays safe to import in browser/Expo bundles.
     * @param {string} url - A module url (usually `import.meta.url`).
     * @returns {string} - The directory path that contains the module.
     */
    static _directoryFromUrl(url) {
        const directoryUrl = new URL(".", url);
        return decodeURIComponent(directoryUrl.pathname).replace(/\/$/, "");
    }
    /**
     * Runs constructor.
     * @param {import("../configuration-types.js").VelociousPackageDescriptor} args - Package descriptor.
     */
    constructor({ name, url, path, modelsPath, resourcesPath, migrationsPath, ...restArgs }) {
        restArgsError(restArgs);
        if (!name) {
            throw new Error("A velocious package requires a name.");
        }
        if (!path && !url) {
            throw new Error(`Velocious package "${name}" requires a "path" or a "url" (usually import.meta.url).`);
        }
        this._name = name;
        this._path = path || VelociousPackage._directoryFromUrl(/** @type {string} */ (url));
        this._modelsPath = modelsPath;
        this._resourcesPath = resourcesPath;
        this._migrationsPath = migrationsPath;
    }
    /**
     * Runs get name.
     * @returns {string} - The package name.
     */
    getName() {
        return this._name;
    }
    /**
     * Runs get path.
     * @returns {string} - The package root directory (the one that contains `src`).
     */
    getPath() {
        return this._path;
    }
    /**
     * Runs get models path.
     * @returns {string} - The package's models directory.
     */
    getModelsPath() {
        return this._modelsPath || `${this._path}/src/models`;
    }
    /**
     * Runs get resources path.
     * @returns {string} - The package's frontend-model resources directory.
     */
    getResourcesPath() {
        return this._resourcesPath || `${this._path}/src/resources`;
    }
    /**
     * Runs get migrations path.
     * @returns {string} - The package's migrations directory.
     */
    getMigrationsPath() {
        return this._migrationsPath || `${this._path}/src/database/migrations`;
    }
    /**
     * Derives the internal backend-project entry the framework appends so the
     * existing resource-discovery + frontend-model generation machinery picks up
     * this package. Generated frontend models are written to the app's output.
     * @param {{frontendModelsOutputPath: string | undefined}} args - The app's frontend-models output path.
     * @returns {import("../configuration-types.js").BackendProjectConfiguration} - The derived backend project.
     */
    toBackendProjectConfiguration({ frontendModelsOutputPath }) {
        return {
            frontendModelsOutputPath,
            path: this.getPath(),
            resourcesPath: this.getResourcesPath()
        };
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidmVsb2Npb3VzLXBhY2thZ2UuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvcGFja2FnZXMvdmVsb2Npb3VzLXBhY2thZ2UuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sYUFBYSxNQUFNLDZCQUE2QixDQUFBO0FBRXZEOzs7Ozs7R0FNRztBQUNILE1BQU0sQ0FBQyxPQUFPLE9BQU8sZ0JBQWdCO0lBQ25DOzs7OztPQUtHO0lBQ0gsTUFBTSxDQUFDLElBQUksQ0FBQyxVQUFVO1FBQ3BCLElBQUksVUFBVSxZQUFZLGdCQUFnQixFQUFFLENBQUM7WUFDM0MsT0FBTyxVQUFVLENBQUE7UUFDbkIsQ0FBQztRQUVELE9BQU8sSUFBSSxnQkFBZ0IsQ0FBQyxVQUFVLENBQUMsQ0FBQTtJQUN6QyxDQUFDO0lBRUQ7Ozs7O09BS0c7SUFDSCxNQUFNLENBQUMsaUJBQWlCLENBQUMsR0FBRztRQUMxQixNQUFNLFlBQVksR0FBRyxJQUFJLEdBQUcsQ0FBQyxHQUFHLEVBQUUsR0FBRyxDQUFDLENBQUE7UUFFdEMsT0FBTyxrQkFBa0IsQ0FBQyxZQUFZLENBQUMsUUFBUSxDQUFDLENBQUMsT0FBTyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsQ0FBQTtJQUNyRSxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsWUFBWSxFQUFDLElBQUksRUFBRSxHQUFHLEVBQUUsSUFBSSxFQUFFLFVBQVUsRUFBRSxhQUFhLEVBQUUsY0FBYyxFQUFFLEdBQUcsUUFBUSxFQUFDO1FBQ25GLGFBQWEsQ0FBQyxRQUFRLENBQUMsQ0FBQTtRQUV2QixJQUFJLENBQUMsSUFBSSxFQUFFLENBQUM7WUFDVixNQUFNLElBQUksS0FBSyxDQUFDLHNDQUFzQyxDQUFDLENBQUE7UUFDekQsQ0FBQztRQUVELElBQUksQ0FBQyxJQUFJLElBQUksQ0FBQyxHQUFHLEVBQUUsQ0FBQztZQUNsQixNQUFNLElBQUksS0FBSyxDQUFDLHNCQUFzQixJQUFJLDJEQUEyRCxDQUFDLENBQUE7UUFDeEcsQ0FBQztRQUVELElBQUksQ0FBQyxLQUFLLEdBQUcsSUFBSSxDQUFBO1FBQ2pCLElBQUksQ0FBQyxLQUFLLEdBQUcsSUFBSSxJQUFJLGdCQUFnQixDQUFDLGlCQUFpQixDQUFDLHFCQUFxQixDQUFDLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQTtRQUNwRixJQUFJLENBQUMsV0FBVyxHQUFHLFVBQVUsQ0FBQTtRQUM3QixJQUFJLENBQUMsY0FBYyxHQUFHLGFBQWEsQ0FBQTtRQUNuQyxJQUFJLENBQUMsZUFBZSxHQUFHLGNBQWMsQ0FBQTtJQUN2QyxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsT0FBTztRQUNMLE9BQU8sSUFBSSxDQUFDLEtBQUssQ0FBQTtJQUNuQixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsT0FBTztRQUNMLE9BQU8sSUFBSSxDQUFDLEtBQUssQ0FBQTtJQUNuQixDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsYUFBYTtRQUNYLE9BQU8sSUFBSSxDQUFDLFdBQVcsSUFBSSxHQUFHLElBQUksQ0FBQyxLQUFLLGFBQWEsQ0FBQTtJQUN2RCxDQUFDO0lBRUQ7OztPQUdHO0lBQ0gsZ0JBQWdCO1FBQ2QsT0FBTyxJQUFJLENBQUMsY0FBYyxJQUFJLEdBQUcsSUFBSSxDQUFDLEtBQUssZ0JBQWdCLENBQUE7SUFDN0QsQ0FBQztJQUVEOzs7T0FHRztJQUNILGlCQUFpQjtRQUNmLE9BQU8sSUFBSSxDQUFDLGVBQWUsSUFBSSxHQUFHLElBQUksQ0FBQyxLQUFLLDBCQUEwQixDQUFBO0lBQ3hFLENBQUM7SUFFRDs7Ozs7O09BTUc7SUFDSCw2QkFBNkIsQ0FBQyxFQUFDLHdCQUF3QixFQUFDO1FBQ3RELE9BQU87WUFDTCx3QkFBd0I7WUFDeEIsSUFBSSxFQUFFLElBQUksQ0FBQyxPQUFPLEVBQUU7WUFDcEIsYUFBYSxFQUFFLElBQUksQ0FBQyxnQkFBZ0IsRUFBRTtTQUN2QyxDQUFBO0lBQ0gsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLy8gQHRzLWNoZWNrXG5cbmltcG9ydCByZXN0QXJnc0Vycm9yIGZyb20gXCIuLi91dGlscy9yZXN0LWFyZ3MtZXJyb3IuanNcIlxuXG4vKipcbiAqIEEgVmVsb2Npb3VzIHBhY2thZ2UgKGVuZ2luZSk6IGFuIGV4dGVybmFsIG5wbSBwYWNrYWdlIHRoYXQgY29udHJpYnV0ZXMgZGF0YVxuICogbW9kZWxzLCBmcm9udGVuZC1tb2RlbCByZXNvdXJjZXMgYW5kIG1pZ3JhdGlvbnMgdG8gYSBjb25zdW1pbmcgYXBwLiBUaGUgYXBwXG4gKiBsaXN0cyBwYWNrYWdlcyBpbiBgQ29uZmlndXJhdGlvbih7cGFja2FnZXM6IFsuLi5dfSlgOyB0aGUgZnJhbWV3b3JrIHRoZW4gbG9hZHNcbiAqIHRoZSBwYWNrYWdlJ3MgYHNyYy9tb2RlbHNgLCBkaXNjb3ZlcnMgaXRzIGBzcmMvcmVzb3VyY2VzYCwgcnVucyBpdHNcbiAqIGBzcmMvZGF0YWJhc2UvbWlncmF0aW9uc2AsIGFuZCBnZW5lcmF0ZXMgaXRzIGZyb250ZW5kIG1vZGVscyBpbnRvIHRoZSBhcHAuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c1BhY2thZ2Uge1xuICAvKipcbiAgICogV3JhcHMgYSBwbGFpbiBkZXNjcmlwdG9yIGFzIGEgVmVsb2Npb3VzUGFja2FnZSAob3IgcmV0dXJucyBpdCB1bmNoYW5nZWQgd2hlblxuICAgKiBpdCBhbHJlYWR5IGlzIG9uZSksIHNvIHBhY2thZ2VzIGNhbiBiZSBsaXN0ZWQgd2l0aG91dCBpbXBvcnRpbmcgdGhpcyBjbGFzcy5cbiAgICogQHBhcmFtIHtWZWxvY2lvdXNQYWNrYWdlIHwgaW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi10eXBlcy5qc1wiKS5WZWxvY2lvdXNQYWNrYWdlRGVzY3JpcHRvcn0gZGVzY3JpcHRvciAtIFBhY2thZ2Ugb3IgcGxhaW4gZGVzY3JpcHRvci5cbiAgICogQHJldHVybnMge1ZlbG9jaW91c1BhY2thZ2V9IC0gVGhlIHBhY2thZ2UgaW5zdGFuY2UuXG4gICAqL1xuICBzdGF0aWMgZnJvbShkZXNjcmlwdG9yKSB7XG4gICAgaWYgKGRlc2NyaXB0b3IgaW5zdGFuY2VvZiBWZWxvY2lvdXNQYWNrYWdlKSB7XG4gICAgICByZXR1cm4gZGVzY3JpcHRvclxuICAgIH1cblxuICAgIHJldHVybiBuZXcgVmVsb2Npb3VzUGFja2FnZShkZXNjcmlwdG9yKVxuICB9XG5cbiAgLyoqXG4gICAqIERlcml2ZXMgdGhlIGNvbnRhaW5pbmcgZGlyZWN0b3J5IG9mIGEgbW9kdWxlIHVybCB3aXRob3V0IE5vZGUncyBgcGF0aGAvYHVybGBcbiAgICogbW9kdWxlcywgc28gdGhpcyBjbGFzcyBzdGF5cyBzYWZlIHRvIGltcG9ydCBpbiBicm93c2VyL0V4cG8gYnVuZGxlcy5cbiAgICogQHBhcmFtIHtzdHJpbmd9IHVybCAtIEEgbW9kdWxlIHVybCAodXN1YWxseSBgaW1wb3J0Lm1ldGEudXJsYCkuXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIGRpcmVjdG9yeSBwYXRoIHRoYXQgY29udGFpbnMgdGhlIG1vZHVsZS5cbiAgICovXG4gIHN0YXRpYyBfZGlyZWN0b3J5RnJvbVVybCh1cmwpIHtcbiAgICBjb25zdCBkaXJlY3RvcnlVcmwgPSBuZXcgVVJMKFwiLlwiLCB1cmwpXG5cbiAgICByZXR1cm4gZGVjb2RlVVJJQ29tcG9uZW50KGRpcmVjdG9yeVVybC5wYXRobmFtZSkucmVwbGFjZSgvXFwvJC8sIFwiXCIpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBjb25zdHJ1Y3Rvci5cbiAgICogQHBhcmFtIHtpbXBvcnQoXCIuLi9jb25maWd1cmF0aW9uLXR5cGVzLmpzXCIpLlZlbG9jaW91c1BhY2thZ2VEZXNjcmlwdG9yfSBhcmdzIC0gUGFja2FnZSBkZXNjcmlwdG9yLlxuICAgKi9cbiAgY29uc3RydWN0b3Ioe25hbWUsIHVybCwgcGF0aCwgbW9kZWxzUGF0aCwgcmVzb3VyY2VzUGF0aCwgbWlncmF0aW9uc1BhdGgsIC4uLnJlc3RBcmdzfSkge1xuICAgIHJlc3RBcmdzRXJyb3IocmVzdEFyZ3MpXG5cbiAgICBpZiAoIW5hbWUpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcihcIkEgdmVsb2Npb3VzIHBhY2thZ2UgcmVxdWlyZXMgYSBuYW1lLlwiKVxuICAgIH1cblxuICAgIGlmICghcGF0aCAmJiAhdXJsKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoYFZlbG9jaW91cyBwYWNrYWdlIFwiJHtuYW1lfVwiIHJlcXVpcmVzIGEgXCJwYXRoXCIgb3IgYSBcInVybFwiICh1c3VhbGx5IGltcG9ydC5tZXRhLnVybCkuYClcbiAgICB9XG5cbiAgICB0aGlzLl9uYW1lID0gbmFtZVxuICAgIHRoaXMuX3BhdGggPSBwYXRoIHx8IFZlbG9jaW91c1BhY2thZ2UuX2RpcmVjdG9yeUZyb21VcmwoLyoqIEB0eXBlIHtzdHJpbmd9ICovICh1cmwpKVxuICAgIHRoaXMuX21vZGVsc1BhdGggPSBtb2RlbHNQYXRoXG4gICAgdGhpcy5fcmVzb3VyY2VzUGF0aCA9IHJlc291cmNlc1BhdGhcbiAgICB0aGlzLl9taWdyYXRpb25zUGF0aCA9IG1pZ3JhdGlvbnNQYXRoXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgbmFtZS5cbiAgICogQHJldHVybnMge3N0cmluZ30gLSBUaGUgcGFja2FnZSBuYW1lLlxuICAgKi9cbiAgZ2V0TmFtZSgpIHtcbiAgICByZXR1cm4gdGhpcy5fbmFtZVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHBhdGguXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIHBhY2thZ2Ugcm9vdCBkaXJlY3RvcnkgKHRoZSBvbmUgdGhhdCBjb250YWlucyBgc3JjYCkuXG4gICAqL1xuICBnZXRQYXRoKCkge1xuICAgIHJldHVybiB0aGlzLl9wYXRoXG4gIH1cblxuICAvKipcbiAgICogUnVucyBnZXQgbW9kZWxzIHBhdGguXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIHBhY2thZ2UncyBtb2RlbHMgZGlyZWN0b3J5LlxuICAgKi9cbiAgZ2V0TW9kZWxzUGF0aCgpIHtcbiAgICByZXR1cm4gdGhpcy5fbW9kZWxzUGF0aCB8fCBgJHt0aGlzLl9wYXRofS9zcmMvbW9kZWxzYFxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZ2V0IHJlc291cmNlcyBwYXRoLlxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSAtIFRoZSBwYWNrYWdlJ3MgZnJvbnRlbmQtbW9kZWwgcmVzb3VyY2VzIGRpcmVjdG9yeS5cbiAgICovXG4gIGdldFJlc291cmNlc1BhdGgoKSB7XG4gICAgcmV0dXJuIHRoaXMuX3Jlc291cmNlc1BhdGggfHwgYCR7dGhpcy5fcGF0aH0vc3JjL3Jlc291cmNlc2BcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIGdldCBtaWdyYXRpb25zIHBhdGguXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IC0gVGhlIHBhY2thZ2UncyBtaWdyYXRpb25zIGRpcmVjdG9yeS5cbiAgICovXG4gIGdldE1pZ3JhdGlvbnNQYXRoKCkge1xuICAgIHJldHVybiB0aGlzLl9taWdyYXRpb25zUGF0aCB8fCBgJHt0aGlzLl9wYXRofS9zcmMvZGF0YWJhc2UvbWlncmF0aW9uc2BcbiAgfVxuXG4gIC8qKlxuICAgKiBEZXJpdmVzIHRoZSBpbnRlcm5hbCBiYWNrZW5kLXByb2plY3QgZW50cnkgdGhlIGZyYW1ld29yayBhcHBlbmRzIHNvIHRoZVxuICAgKiBleGlzdGluZyByZXNvdXJjZS1kaXNjb3ZlcnkgKyBmcm9udGVuZC1tb2RlbCBnZW5lcmF0aW9uIG1hY2hpbmVyeSBwaWNrcyB1cFxuICAgKiB0aGlzIHBhY2thZ2UuIEdlbmVyYXRlZCBmcm9udGVuZCBtb2RlbHMgYXJlIHdyaXR0ZW4gdG8gdGhlIGFwcCdzIG91dHB1dC5cbiAgICogQHBhcmFtIHt7ZnJvbnRlbmRNb2RlbHNPdXRwdXRQYXRoOiBzdHJpbmcgfCB1bmRlZmluZWR9fSBhcmdzIC0gVGhlIGFwcCdzIGZyb250ZW5kLW1vZGVscyBvdXRwdXQgcGF0aC5cbiAgICogQHJldHVybnMge2ltcG9ydChcIi4uL2NvbmZpZ3VyYXRpb24tdHlwZXMuanNcIikuQmFja2VuZFByb2plY3RDb25maWd1cmF0aW9ufSAtIFRoZSBkZXJpdmVkIGJhY2tlbmQgcHJvamVjdC5cbiAgICovXG4gIHRvQmFja2VuZFByb2plY3RDb25maWd1cmF0aW9uKHtmcm9udGVuZE1vZGVsc091dHB1dFBhdGh9KSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGZyb250ZW5kTW9kZWxzT3V0cHV0UGF0aCxcbiAgICAgIHBhdGg6IHRoaXMuZ2V0UGF0aCgpLFxuICAgICAgcmVzb3VyY2VzUGF0aDogdGhpcy5nZXRSZXNvdXJjZXNQYXRoKClcbiAgICB9XG4gIH1cbn1cbiJdfQ==