import { watch as fsWatch } from "fs";
import fs from "fs/promises";
import Logger from "../logger.js";
/**
 * Development-only file watcher that asks the HTTP server to recycle workers
 * when application source files change.
 */
export default class VelociousHttpServerDevelopmentReloader {
    configuration: import("../configuration.js").default;
    debounceMs: number;
    logger: Logger;
    onReload: (args: {
        changedPath: string;
    }) => Promise<void>;
    readdir: typeof fs.readdir;
    stat: typeof fs.stat;
    watchFactory: typeof fsWatch;
    /**
     * Narrows the runtime value to the documented type.
     * @type {ReturnType<typeof setTimeout> | undefined} */
    reloadTimer: ReturnType<typeof setTimeout> | undefined;
    /**
     * Narrows the runtime value to the documented type.
     * @type {string | undefined} */
    pendingChangedPath: string | undefined;
    /**
     * Narrows the runtime value to the documented type.
     * @type {Map<string, import("fs").FSWatcher>} */
    watchers: Map<string, import("fs").FSWatcher>;
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
    constructor({ configuration, onReload, debounceMs, watchFactory, readdir, stat }: {
        configuration: import("../configuration.js").default;
        onReload: (args: {
            changedPath: string;
        }) => Promise<void>;
        debounceMs?: number;
        watchFactory?: typeof fsWatch;
        readdir?: typeof fs.readdir;
        stat?: typeof fs.stat;
    });
    /**
     * Runs start.
     * @returns {Promise<void>} - Resolves when watching has started.
     */
    start(): Promise<void>;
    /**
     * Runs watch root paths.
     * @returns {string[]} - Source directories to watch.
     */
    watchRootPaths(): string[];
    /**
     * Runs watch directory recursive.
     * @param {string} directoryPath - Directory path.
     * @returns {Promise<void>} - Resolves when child directories are watched.
     */
    watchDirectoryRecursive(directoryPath: string): Promise<void>;
    /**
     * Runs on watcher event.
     * @param {object} args - Options object.
     * @param {string} args.directoryPath - Watched directory path.
     * @param {string} args.eventType - Watch event type.
     * @param {string | Buffer | null} args.fileName - Relative changed filename.
     * @returns {Promise<void>} - Resolves when complete.
     */
    onWatcherEvent({ directoryPath, eventType, fileName }: {
        directoryPath: string;
        eventType: string;
        fileName: string | Buffer | null;
    }): Promise<void>;
    /**
     * Runs should reload path.
     * @param {object} args - Options object.
     * @param {string} args.changedPath - Changed path.
     * @param {string | Buffer | null} args.fileName - Raw filename from fs.watch.
     * @returns {boolean} - Whether the path should trigger reload.
     */
    shouldReloadPath({ changedPath, fileName }: {
        changedPath: string;
        fileName: string | Buffer | null;
    }): boolean;
    /**
     * Runs watch potential directory.
     * @param {string} changedPath - Candidate directory path.
     * @returns {Promise<void>} - Resolves when any new directory watchers are added.
     */
    watchPotentialDirectory(changedPath: string): Promise<void>;
    /**
     * Runs schedule reload.
     * @param {string} changedPath - Changed path.
     * @returns {void} - No return value.
     */
    scheduleReload(changedPath: string): void;
    /**
     * Runs flush reload.
     * @returns {Promise<void>} - Resolves when the queued reload is handled.
     */
    flushReload(): Promise<void>;
    /**
     * On watcher error.
     * @param {Error} error - Watcher error.
     * @returns {void} - No return value.
     */
    onWatcherError: (error: Error) => void;
    /**
     * Runs stop.
     * @returns {Promise<void>} - Resolves when watchers are closed.
     */
    stop(): Promise<void>;
}
//# sourceMappingURL=development-reloader.d.ts.map