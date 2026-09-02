// @ts-check
import { watch as fsWatch } from "fs";
import fs from "fs/promises";
import Logger from "../logger.js";
import path from "path";
const RELOADABLE_EXTENSIONS = new Set([
    ".cjs",
    ".ejs",
    ".js",
    ".json",
    ".mjs"
]);
/**
 * Development-only file watcher that asks the HTTP server to recycle workers
 * when application source files change.
 */
export default class VelociousHttpServerDevelopmentReloader {
    /**
     * Runs constructor.
     * @param {object} args - Options object.
     * @param {import("../configuration.js").default} args.configuration - Configuration instance.
     * @param {(args: {changedPath: string}) => Promise<void>} args.onReload - Reload callback.
     * @param {number} [args.debounceMs] - Debounce window for grouped changes.
     * @param {typeof fsWatch} [args.watchFactory] - File watch factory.
     * @param {typeof fs.readdir} [args.readdir] - Directory reader.
     * @param {typeof fs.stat} [args.stat] - Stat reader.
     */
    constructor({ configuration, onReload, debounceMs = 75, watchFactory = fsWatch, readdir = fs.readdir, stat = fs.stat }) {
        this.configuration = configuration;
        this.debounceMs = debounceMs;
        this.logger = new Logger("DevelopmentReloader", { configuration });
        this.onReload = onReload;
        this.readdir = readdir;
        this.stat = stat;
        this.watchFactory = watchFactory;
        /**
         * Narrows the runtime value to the documented type.
         * @type {ReturnType<typeof setTimeout> | undefined} */
        this.reloadTimer = undefined;
        /**
         * Narrows the runtime value to the documented type.
         * @type {string | undefined} */
        this.pendingChangedPath = undefined;
        /**
         * Narrows the runtime value to the documented type.
         * @type {Map<string, import("fs").FSWatcher>} */
        this.watchers = new Map();
    }
    /**
     * Runs start.
     * @returns {Promise<void>} - Resolves when watching has started.
     */
    async start() {
        for (const rootPath of this.watchRootPaths()) {
            await this.watchDirectoryRecursive(rootPath);
        }
    }
    /**
     * Runs watch root paths.
     * @returns {string[]} - Source directories to watch.
     */
    watchRootPaths() {
        const rootPaths = new Set();
        const configurationDirectory = this.configuration.getDirectory();
        rootPaths.add(path.join(configurationDirectory, "src"));
        for (const backendProject of this.configuration.getBackendProjects()) {
            if (!backendProject?.path)
                continue;
            rootPaths.add(path.join(backendProject.path, "src"));
        }
        return Array.from(rootPaths);
    }
    /**
     * Runs watch directory recursive.
     * @param {string} directoryPath - Directory path.
     * @returns {Promise<void>} - Resolves when child directories are watched.
     */
    async watchDirectoryRecursive(directoryPath) {
        const resolvedDirectoryPath = path.resolve(directoryPath);
        if (this.watchers.has(resolvedDirectoryPath))
            return;
        let entries;
        try {
            entries = await this.readdir(resolvedDirectoryPath, { withFileTypes: true });
        }
        catch (error) {
            if ( /** @type {{code?: string}} */(error)?.code === "ENOENT")
                return;
            throw error;
        }
        const watcher = this.watchFactory(resolvedDirectoryPath, (eventType, fileName) => {
            void this.onWatcherEvent({
                directoryPath: resolvedDirectoryPath,
                eventType,
                fileName
            });
        });
        watcher.on("error", this.onWatcherError);
        this.watchers.set(resolvedDirectoryPath, watcher);
        for (const entry of entries) {
            if (!entry.isDirectory())
                continue;
            await this.watchDirectoryRecursive(path.join(resolvedDirectoryPath, entry.name));
        }
    }
    /**
     * Runs on watcher event.
     * @param {object} args - Options object.
     * @param {string} args.directoryPath - Watched directory path.
     * @param {string} args.eventType - Watch event type.
     * @param {string | Buffer | null} args.fileName - Relative changed filename.
     * @returns {Promise<void>} - Resolves when complete.
     */
    async onWatcherEvent({ directoryPath, eventType, fileName }) {
        const changedPath = fileName
            ? path.join(directoryPath, fileName.toString())
            : directoryPath;
        await this.watchPotentialDirectory(changedPath);
        if (!this.shouldReloadPath({ changedPath, fileName }))
            return;
        this.scheduleReload(changedPath);
        await this.logger.debug(() => ["Queued development hot reload", { changedPath, eventType }]);
    }
    /**
     * Runs should reload path.
     * @param {object} args - Options object.
     * @param {string} args.changedPath - Changed path.
     * @param {string | Buffer | null} args.fileName - Raw filename from fs.watch.
     * @returns {boolean} - Whether the path should trigger reload.
     */
    shouldReloadPath({ changedPath, fileName }) {
        if (!fileName)
            return true;
        const extension = path.extname(changedPath).toLowerCase();
        return RELOADABLE_EXTENSIONS.has(extension);
    }
    /**
     * Runs watch potential directory.
     * @param {string} changedPath - Candidate directory path.
     * @returns {Promise<void>} - Resolves when any new directory watchers are added.
     */
    async watchPotentialDirectory(changedPath) {
        try {
            const stat = await this.stat(changedPath);
            if (stat.isDirectory()) {
                await this.watchDirectoryRecursive(changedPath);
            }
        }
        catch (error) {
            if ( /** @type {{code?: string}} */(error)?.code !== "ENOENT") {
                throw error;
            }
        }
    }
    /**
     * Runs schedule reload.
     * @param {string} changedPath - Changed path.
     * @returns {void} - No return value.
     */
    scheduleReload(changedPath) {
        this.pendingChangedPath = changedPath;
        if (this.reloadTimer) {
            clearTimeout(this.reloadTimer);
        }
        this.reloadTimer = setTimeout(() => {
            void this.flushReload();
        }, this.debounceMs);
    }
    /**
     * Runs flush reload.
     * @returns {Promise<void>} - Resolves when the queued reload is handled.
     */
    async flushReload() {
        this.reloadTimer = undefined;
        const changedPath = this.pendingChangedPath;
        if (!changedPath)
            return;
        this.pendingChangedPath = undefined;
        await this.onReload({ changedPath });
    }
    /**
     * On watcher error.
     * @param {Error} error - Watcher error.
     * @returns {void} - No return value.
     */
    onWatcherError = (error) => {
        void this.logger.warn("Development hot reload watcher error", error);
    };
    /**
     * Runs stop.
     * @returns {Promise<void>} - Resolves when watchers are closed.
     */
    async stop() {
        if (this.reloadTimer) {
            clearTimeout(this.reloadTimer);
            this.reloadTimer = undefined;
        }
        this.pendingChangedPath = undefined;
        for (const watcher of this.watchers.values()) {
            watcher.close();
        }
        this.watchers.clear();
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZGV2ZWxvcG1lbnQtcmVsb2FkZXIuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvaHR0cC1zZXJ2ZXIvZGV2ZWxvcG1lbnQtcmVsb2FkZXIuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUEsWUFBWTtBQUVaLE9BQU8sRUFBQyxLQUFLLElBQUksT0FBTyxFQUFDLE1BQU0sSUFBSSxDQUFBO0FBQ25DLE9BQU8sRUFBRSxNQUFNLGFBQWEsQ0FBQTtBQUM1QixPQUFPLE1BQU0sTUFBTSxjQUFjLENBQUE7QUFDakMsT0FBTyxJQUFJLE1BQU0sTUFBTSxDQUFBO0FBRXZCLE1BQU0scUJBQXFCLEdBQUcsSUFBSSxHQUFHLENBQUM7SUFDcEMsTUFBTTtJQUNOLE1BQU07SUFDTixLQUFLO0lBQ0wsT0FBTztJQUNQLE1BQU07Q0FDUCxDQUFDLENBQUE7QUFFRjs7O0dBR0c7QUFDSCxNQUFNLENBQUMsT0FBTyxPQUFPLHNDQUFzQztJQUN6RDs7Ozs7Ozs7O09BU0c7SUFDSCxZQUFZLEVBQUMsYUFBYSxFQUFFLFFBQVEsRUFBRSxVQUFVLEdBQUcsRUFBRSxFQUFFLFlBQVksR0FBRyxPQUFPLEVBQUUsT0FBTyxHQUFHLEVBQUUsQ0FBQyxPQUFPLEVBQUUsSUFBSSxHQUFHLEVBQUUsQ0FBQyxJQUFJLEVBQUM7UUFDbEgsSUFBSSxDQUFDLGFBQWEsR0FBRyxhQUFhLENBQUE7UUFDbEMsSUFBSSxDQUFDLFVBQVUsR0FBRyxVQUFVLENBQUE7UUFDNUIsSUFBSSxDQUFDLE1BQU0sR0FBRyxJQUFJLE1BQU0sQ0FBQyxxQkFBcUIsRUFBRSxFQUFDLGFBQWEsRUFBQyxDQUFDLENBQUE7UUFDaEUsSUFBSSxDQUFDLFFBQVEsR0FBRyxRQUFRLENBQUE7UUFDeEIsSUFBSSxDQUFDLE9BQU8sR0FBRyxPQUFPLENBQUE7UUFDdEIsSUFBSSxDQUFDLElBQUksR0FBRyxJQUFJLENBQUE7UUFDaEIsSUFBSSxDQUFDLFlBQVksR0FBRyxZQUFZLENBQUE7UUFF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LElBQUksQ0FBQyxXQUFXLEdBQUcsU0FBUyxDQUFBO1FBQzlCLENBQUM7UUFFRCxJQUFJLENBQUMsa0JBQWtCLEdBQUcsU0FBUyxDQUFBO1FBRW5DLEtBQUssTUFBTSxPQUFPLElBQUksSUFBSSxDQUFDLFFBQVEsQ0FBQyxNQUFNLEVBQUUsRUFBRSxDQUFDO1lBQzdDLE9BQU8sQ0FBQyxLQUFLLEVBQUUsQ0FBQTtRQUNqQixDQUFDO1FBRUQsSUFBSSxDQUFDLFFBQVEsQ0FBQyxLQUFLLEVBQUUsQ0FBQTtJQUN2QixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvLyBAdHMtY2hlY2tcblxuaW1wb3J0IHt3YXRjaCBhcyBmc1dhdGNofSBmcm9tIFwiZnNcIlxuaW1wb3J0IGZzIGZyb20gXCJmcy9wcm9taXNlc1wiXG5pbXBvcnQgTG9nZ2VyIGZyb20gXCIuLi9sb2dnZXIuanNcIlxuaW1wb3J0IHBhdGggZnJvbSBcInBhdGhcIlxuXG5jb25zdCBSRUxPQURBQkxFX0VYVEVOU0lPTlMgPSBuZXcgU2V0KFtcbiAgXCIuY2pzXCIsXG4gIFwiLmVqc1wiLFxuICBcIi5qc1wiLFxuICBcIi5qc29uXCIsXG4gIFwiLm1qc1wiXG5dKVxuXG4vKipcbiAqIERldmVsb3BtZW50LW9ubHkgZmlsZSB3YXRjaGVyIHRoYXQgYXNrcyB0aGUgSFRUUCBzZXJ2ZXIgdG8gcmVjeWNsZSB3b3JrZXJzXG4gKiB3aGVuIGFwcGxpY2F0aW9uIHNvdXJjZSBmaWxlcyBjaGFuZ2UuXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFZlbG9jaW91c0h0dHBTZXJ2ZXJEZXZlbG9wbWVudFJlbG9hZGVyIHtcbiAgLyoqXG4gICAqIFJ1bnMgY29uc3RydWN0b3IuXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7aW1wb3J0KFwiLi4vY29uZmlndXJhdGlvbi5qc1wiKS5kZWZhdWx0fSBhcmdzLmNvbmZpZ3VyYXRpb24gLSBDb25maWd1cmF0aW9uIGluc3RhbmNlLlxuICAgKiBAcGFyYW0geyhhcmdzOiB7Y2hhbmdlZFBhdGg6IHN0cmluZ30pID0+IFByb21pc2U8dm9pZD59IGFyZ3Mub25SZWxvYWQgLSBSZWxvYWQgY2FsbGJhY2suXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbYXJncy5kZWJvdW5jZU1zXSAtIERlYm91bmNlIHdpbmRvdyBmb3IgZ3JvdXBlZCBjaGFuZ2VzLlxuICAgKiBAcGFyYW0ge3R5cGVvZiBmc1dhdGNofSBbYXJncy53YXRjaEZhY3RvcnldIC0gRmlsZSB3YXRjaCBmYWN0b3J5LlxuICAgKiBAcGFyYW0ge3R5cGVvZiBmcy5yZWFkZGlyfSBbYXJncy5yZWFkZGlyXSAtIERpcmVjdG9yeSByZWFkZXIuXG4gICAqIEBwYXJhbSB7dHlwZW9mIGZzLnN0YXR9IFthcmdzLnN0YXRdIC0gU3RhdCByZWFkZXIuXG4gICAqL1xuICBjb25zdHJ1Y3Rvcih7Y29uZmlndXJhdGlvbiwgb25SZWxvYWQsIGRlYm91bmNlTXMgPSA3NSwgd2F0Y2hGYWN0b3J5ID0gZnNXYXRjaCwgcmVhZGRpciA9IGZzLnJlYWRkaXIsIHN0YXQgPSBmcy5zdGF0fSkge1xuICAgIHRoaXMuY29uZmlndXJhdGlvbiA9IGNvbmZpZ3VyYXRpb25cbiAgICB0aGlzLmRlYm91bmNlTXMgPSBkZWJvdW5jZU1zXG4gICAgdGhpcy5sb2dnZXIgPSBuZXcgTG9nZ2VyKFwiRGV2ZWxvcG1lbnRSZWxvYWRlclwiLCB7Y29uZmlndXJhdGlvbn0pXG4gICAgdGhpcy5vblJlbG9hZCA9IG9uUmVsb2FkXG4gICAgdGhpcy5yZWFkZGlyID0gcmVhZGRpclxuICAgIHRoaXMuc3RhdCA9IHN0YXRcbiAgICB0aGlzLndhdGNoRmFjdG9yeSA9IHdhdGNoRmFjdG9yeVxuXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtSZXR1cm5UeXBlPHR5cGVvZiBzZXRUaW1lb3V0PiB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLnJlbG9hZFRpbWVyID0gdW5kZWZpbmVkXG5cbiAgICAvKipcbiAgICAgKiBOYXJyb3dzIHRoZSBydW50aW1lIHZhbHVlIHRvIHRoZSBkb2N1bWVudGVkIHR5cGUuXG4gICAgICogQHR5cGUge3N0cmluZyB8IHVuZGVmaW5lZH0gKi9cbiAgICB0aGlzLnBlbmRpbmdDaGFuZ2VkUGF0aCA9IHVuZGVmaW5lZFxuXG4gICAgLyoqXG4gICAgICogTmFycm93cyB0aGUgcnVudGltZSB2YWx1ZSB0byB0aGUgZG9jdW1lbnRlZCB0eXBlLlxuICAgICAqIEB0eXBlIHtNYXA8c3RyaW5nLCBpbXBvcnQoXCJmc1wiKS5GU1dhdGNoZXI+fSAqL1xuICAgIHRoaXMud2F0Y2hlcnMgPSBuZXcgTWFwKClcbiAgfVxuXG4gIC8qKlxuICAgKiBSdW5zIHN0YXJ0LlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHdhdGNoaW5nIGhhcyBzdGFydGVkLlxuICAgKi9cbiAgYXN5bmMgc3RhcnQoKSB7XG4gICAgZm9yIChjb25zdCByb290UGF0aCBvZiB0aGlzLndhdGNoUm9vdFBhdGhzKCkpIHtcbiAgICAgIGF3YWl0IHRoaXMud2F0Y2hEaXJlY3RvcnlSZWN1cnNpdmUocm9vdFBhdGgpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd2F0Y2ggcm9vdCBwYXRocy5cbiAgICogQHJldHVybnMge3N0cmluZ1tdfSAtIFNvdXJjZSBkaXJlY3RvcmllcyB0byB3YXRjaC5cbiAgICovXG4gIHdhdGNoUm9vdFBhdGhzKCkge1xuICAgIGNvbnN0IHJvb3RQYXRocyA9IG5ldyBTZXQoKVxuICAgIGNvbnN0IGNvbmZpZ3VyYXRpb25EaXJlY3RvcnkgPSB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0RGlyZWN0b3J5KClcblxuICAgIHJvb3RQYXRocy5hZGQocGF0aC5qb2luKGNvbmZpZ3VyYXRpb25EaXJlY3RvcnksIFwic3JjXCIpKVxuXG4gICAgZm9yIChjb25zdCBiYWNrZW5kUHJvamVjdCBvZiB0aGlzLmNvbmZpZ3VyYXRpb24uZ2V0QmFja2VuZFByb2plY3RzKCkpIHtcbiAgICAgIGlmICghYmFja2VuZFByb2plY3Q/LnBhdGgpIGNvbnRpbnVlXG4gICAgICByb290UGF0aHMuYWRkKHBhdGguam9pbihiYWNrZW5kUHJvamVjdC5wYXRoLCBcInNyY1wiKSlcbiAgICB9XG5cbiAgICByZXR1cm4gQXJyYXkuZnJvbShyb290UGF0aHMpXG4gIH1cblxuICAvKipcbiAgICogUnVucyB3YXRjaCBkaXJlY3RvcnkgcmVjdXJzaXZlLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gZGlyZWN0b3J5UGF0aCAtIERpcmVjdG9yeSBwYXRoLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGNoaWxkIGRpcmVjdG9yaWVzIGFyZSB3YXRjaGVkLlxuICAgKi9cbiAgYXN5bmMgd2F0Y2hEaXJlY3RvcnlSZWN1cnNpdmUoZGlyZWN0b3J5UGF0aCkge1xuICAgIGNvbnN0IHJlc29sdmVkRGlyZWN0b3J5UGF0aCA9IHBhdGgucmVzb2x2ZShkaXJlY3RvcnlQYXRoKVxuXG4gICAgaWYgKHRoaXMud2F0Y2hlcnMuaGFzKHJlc29sdmVkRGlyZWN0b3J5UGF0aCkpIHJldHVyblxuXG4gICAgbGV0IGVudHJpZXNcblxuICAgIHRyeSB7XG4gICAgICBlbnRyaWVzID0gYXdhaXQgdGhpcy5yZWFkZGlyKHJlc29sdmVkRGlyZWN0b3J5UGF0aCwge3dpdGhGaWxlVHlwZXM6IHRydWV9KVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICBpZiAoLyoqIEB0eXBlIHt7Y29kZT86IHN0cmluZ319ICovIChlcnJvcik/LmNvZGUgPT09IFwiRU5PRU5UXCIpIHJldHVyblxuICAgICAgdGhyb3cgZXJyb3JcbiAgICB9XG5cbiAgICBjb25zdCB3YXRjaGVyID0gdGhpcy53YXRjaEZhY3RvcnkocmVzb2x2ZWREaXJlY3RvcnlQYXRoLCAoZXZlbnRUeXBlLCBmaWxlTmFtZSkgPT4ge1xuICAgICAgdm9pZCB0aGlzLm9uV2F0Y2hlckV2ZW50KHtcbiAgICAgICAgZGlyZWN0b3J5UGF0aDogcmVzb2x2ZWREaXJlY3RvcnlQYXRoLFxuICAgICAgICBldmVudFR5cGUsXG4gICAgICAgIGZpbGVOYW1lXG4gICAgICB9KVxuICAgIH0pXG5cbiAgICB3YXRjaGVyLm9uKFwiZXJyb3JcIiwgdGhpcy5vbldhdGNoZXJFcnJvcilcbiAgICB0aGlzLndhdGNoZXJzLnNldChyZXNvbHZlZERpcmVjdG9yeVBhdGgsIHdhdGNoZXIpXG5cbiAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIGVudHJpZXMpIHtcbiAgICAgIGlmICghZW50cnkuaXNEaXJlY3RvcnkoKSkgY29udGludWVcblxuICAgICAgYXdhaXQgdGhpcy53YXRjaERpcmVjdG9yeVJlY3Vyc2l2ZShwYXRoLmpvaW4ocmVzb2x2ZWREaXJlY3RvcnlQYXRoLCBlbnRyeS5uYW1lKSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUnVucyBvbiB3YXRjaGVyIGV2ZW50LlxuICAgKiBAcGFyYW0ge29iamVjdH0gYXJncyAtIE9wdGlvbnMgb2JqZWN0LlxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXJncy5kaXJlY3RvcnlQYXRoIC0gV2F0Y2hlZCBkaXJlY3RvcnkgcGF0aC5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGFyZ3MuZXZlbnRUeXBlIC0gV2F0Y2ggZXZlbnQgdHlwZS5cbiAgICogQHBhcmFtIHtzdHJpbmcgfCBCdWZmZXIgfCBudWxsfSBhcmdzLmZpbGVOYW1lIC0gUmVsYXRpdmUgY2hhbmdlZCBmaWxlbmFtZS5cbiAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59IC0gUmVzb2x2ZXMgd2hlbiBjb21wbGV0ZS5cbiAgICovXG4gIGFzeW5jIG9uV2F0Y2hlckV2ZW50KHtkaXJlY3RvcnlQYXRoLCBldmVudFR5cGUsIGZpbGVOYW1lfSkge1xuICAgIGNvbnN0IGNoYW5nZWRQYXRoID0gZmlsZU5hbWVcbiAgICAgID8gcGF0aC5qb2luKGRpcmVjdG9yeVBhdGgsIGZpbGVOYW1lLnRvU3RyaW5nKCkpXG4gICAgICA6IGRpcmVjdG9yeVBhdGhcblxuICAgIGF3YWl0IHRoaXMud2F0Y2hQb3RlbnRpYWxEaXJlY3RvcnkoY2hhbmdlZFBhdGgpXG5cbiAgICBpZiAoIXRoaXMuc2hvdWxkUmVsb2FkUGF0aCh7Y2hhbmdlZFBhdGgsIGZpbGVOYW1lfSkpIHJldHVyblxuXG4gICAgdGhpcy5zY2hlZHVsZVJlbG9hZChjaGFuZ2VkUGF0aClcblxuICAgIGF3YWl0IHRoaXMubG9nZ2VyLmRlYnVnKCgpID0+IFtcIlF1ZXVlZCBkZXZlbG9wbWVudCBob3QgcmVsb2FkXCIsIHtjaGFuZ2VkUGF0aCwgZXZlbnRUeXBlfV0pXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzaG91bGQgcmVsb2FkIHBhdGguXG4gICAqIEBwYXJhbSB7b2JqZWN0fSBhcmdzIC0gT3B0aW9ucyBvYmplY3QuXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBhcmdzLmNoYW5nZWRQYXRoIC0gQ2hhbmdlZCBwYXRoLlxuICAgKiBAcGFyYW0ge3N0cmluZyB8IEJ1ZmZlciB8IG51bGx9IGFyZ3MuZmlsZU5hbWUgLSBSYXcgZmlsZW5hbWUgZnJvbSBmcy53YXRjaC5cbiAgICogQHJldHVybnMge2Jvb2xlYW59IC0gV2hldGhlciB0aGUgcGF0aCBzaG91bGQgdHJpZ2dlciByZWxvYWQuXG4gICAqL1xuICBzaG91bGRSZWxvYWRQYXRoKHtjaGFuZ2VkUGF0aCwgZmlsZU5hbWV9KSB7XG4gICAgaWYgKCFmaWxlTmFtZSkgcmV0dXJuIHRydWVcblxuICAgIGNvbnN0IGV4dGVuc2lvbiA9IHBhdGguZXh0bmFtZShjaGFuZ2VkUGF0aCkudG9Mb3dlckNhc2UoKVxuXG4gICAgcmV0dXJuIFJFTE9BREFCTEVfRVhURU5TSU9OUy5oYXMoZXh0ZW5zaW9uKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgd2F0Y2ggcG90ZW50aWFsIGRpcmVjdG9yeS5cbiAgICogQHBhcmFtIHtzdHJpbmd9IGNoYW5nZWRQYXRoIC0gQ2FuZGlkYXRlIGRpcmVjdG9yeSBwYXRoLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIGFueSBuZXcgZGlyZWN0b3J5IHdhdGNoZXJzIGFyZSBhZGRlZC5cbiAgICovXG4gIGFzeW5jIHdhdGNoUG90ZW50aWFsRGlyZWN0b3J5KGNoYW5nZWRQYXRoKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHN0YXQgPSBhd2FpdCB0aGlzLnN0YXQoY2hhbmdlZFBhdGgpXG5cbiAgICAgIGlmIChzdGF0LmlzRGlyZWN0b3J5KCkpIHtcbiAgICAgICAgYXdhaXQgdGhpcy53YXRjaERpcmVjdG9yeVJlY3Vyc2l2ZShjaGFuZ2VkUGF0aClcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgaWYgKC8qKiBAdHlwZSB7e2NvZGU/OiBzdHJpbmd9fSAqLyAoZXJyb3IpPy5jb2RlICE9PSBcIkVOT0VOVFwiKSB7XG4gICAgICAgIHRocm93IGVycm9yXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgc2NoZWR1bGUgcmVsb2FkLlxuICAgKiBAcGFyYW0ge3N0cmluZ30gY2hhbmdlZFBhdGggLSBDaGFuZ2VkIHBhdGguXG4gICAqIEByZXR1cm5zIHt2b2lkfSAtIE5vIHJldHVybiB2YWx1ZS5cbiAgICovXG4gIHNjaGVkdWxlUmVsb2FkKGNoYW5nZWRQYXRoKSB7XG4gICAgdGhpcy5wZW5kaW5nQ2hhbmdlZFBhdGggPSBjaGFuZ2VkUGF0aFxuXG4gICAgaWYgKHRoaXMucmVsb2FkVGltZXIpIHtcbiAgICAgIGNsZWFyVGltZW91dCh0aGlzLnJlbG9hZFRpbWVyKVxuICAgIH1cblxuICAgIHRoaXMucmVsb2FkVGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgIHZvaWQgdGhpcy5mbHVzaFJlbG9hZCgpXG4gICAgfSwgdGhpcy5kZWJvdW5jZU1zKVxuICB9XG5cbiAgLyoqXG4gICAqIFJ1bnMgZmx1c2ggcmVsb2FkLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHRoZSBxdWV1ZWQgcmVsb2FkIGlzIGhhbmRsZWQuXG4gICAqL1xuICBhc3luYyBmbHVzaFJlbG9hZCgpIHtcbiAgICB0aGlzLnJlbG9hZFRpbWVyID0gdW5kZWZpbmVkXG5cbiAgICBjb25zdCBjaGFuZ2VkUGF0aCA9IHRoaXMucGVuZGluZ0NoYW5nZWRQYXRoXG5cbiAgICBpZiAoIWNoYW5nZWRQYXRoKSByZXR1cm5cblxuICAgIHRoaXMucGVuZGluZ0NoYW5nZWRQYXRoID0gdW5kZWZpbmVkXG4gICAgYXdhaXQgdGhpcy5vblJlbG9hZCh7Y2hhbmdlZFBhdGh9KVxuICB9XG5cbiAgLyoqXG4gICAqIE9uIHdhdGNoZXIgZXJyb3IuXG4gICAqIEBwYXJhbSB7RXJyb3J9IGVycm9yIC0gV2F0Y2hlciBlcnJvci5cbiAgICogQHJldHVybnMge3ZvaWR9IC0gTm8gcmV0dXJuIHZhbHVlLlxuICAgKi9cbiAgb25XYXRjaGVyRXJyb3IgPSAoZXJyb3IpID0+IHtcbiAgICB2b2lkIHRoaXMubG9nZ2VyLndhcm4oXCJEZXZlbG9wbWVudCBob3QgcmVsb2FkIHdhdGNoZXIgZXJyb3JcIiwgZXJyb3IpXG4gIH1cblxuICAvKipcbiAgICogUnVucyBzdG9wLlxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn0gLSBSZXNvbHZlcyB3aGVuIHdhdGNoZXJzIGFyZSBjbG9zZWQuXG4gICAqL1xuICBhc3luYyBzdG9wKCkge1xuICAgIGlmICh0aGlzLnJlbG9hZFRpbWVyKSB7XG4gICAgICBjbGVhclRpbWVvdXQodGhpcy5yZWxvYWRUaW1lcilcbiAgICAgIHRoaXMucmVsb2FkVGltZXIgPSB1bmRlZmluZWRcbiAgICB9XG5cbiAgICB0aGlzLnBlbmRpbmdDaGFuZ2VkUGF0aCA9IHVuZGVmaW5lZFxuXG4gICAgZm9yIChjb25zdCB3YXRjaGVyIG9mIHRoaXMud2F0Y2hlcnMudmFsdWVzKCkpIHtcbiAgICAgIHdhdGNoZXIuY2xvc2UoKVxuICAgIH1cblxuICAgIHRoaXMud2F0Y2hlcnMuY2xlYXIoKVxuICB9XG59XG4iXX0=