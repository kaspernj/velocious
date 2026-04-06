// @ts-check

import {watch as fsWatch} from "fs"
import fs from "fs/promises"
import Logger from "../logger.js"
import path from "path"

const RELOADABLE_EXTENSIONS = new Set([
  ".cjs",
  ".ejs",
  ".js",
  ".json",
  ".mjs"
])

/**
 * Development-only file watcher that asks the HTTP server to recycle workers
 * when application source files change.
 */
export default class VelociousHttpServerDevelopmentReloader {
  /**
   * @param {object} args - Options object.
   * @param {import("../configuration.js").default} args.configuration - Configuration instance.
   * @param {function({changedPath: string}) : Promise<void>} args.onReload - Reload callback.
   * @param {number} [args.debounceMs] - Debounce window for grouped changes.
   * @param {typeof fsWatch} [args.watchFactory] - File watch factory.
   * @param {typeof fs.readdir} [args.readdir] - Directory reader.
   * @param {typeof fs.stat} [args.stat] - Stat reader.
   */
  constructor({configuration, onReload, debounceMs = 75, watchFactory = fsWatch, readdir = fs.readdir, stat = fs.stat}) {
    this.configuration = configuration
    this.debounceMs = debounceMs
    this.logger = new Logger("DevelopmentReloader", {configuration})
    this.onReload = onReload
    this.readdir = readdir
    this.stat = stat
    this.watchFactory = watchFactory

    /** @type {ReturnType<typeof setTimeout> | undefined} */
    this.reloadTimer = undefined

    /** @type {string | undefined} */
    this.pendingChangedPath = undefined

    /** @type {Map<string, import("fs").FSWatcher>} */
    this.watchers = new Map()
  }

  /** @returns {Promise<void>} - Resolves when watching has started. */
  async start() {
    for (const rootPath of this.watchRootPaths()) {
      await this.watchDirectoryRecursive(rootPath)
    }
  }

  /** @returns {string[]} - Source directories to watch. */
  watchRootPaths() {
    const rootPaths = new Set()
    const configurationDirectory = this.configuration.getDirectory()

    rootPaths.add(path.join(configurationDirectory, "src"))

    for (const backendProject of this.configuration.getBackendProjects()) {
      if (!backendProject?.path) continue
      rootPaths.add(path.join(backendProject.path, "src"))
    }

    return Array.from(rootPaths)
  }

  /**
   * @param {string} directoryPath - Directory path.
   * @returns {Promise<void>} - Resolves when child directories are watched.
   */
  async watchDirectoryRecursive(directoryPath) {
    const resolvedDirectoryPath = path.resolve(directoryPath)

    if (this.watchers.has(resolvedDirectoryPath)) return

    let entries

    try {
      entries = await this.readdir(resolvedDirectoryPath, {withFileTypes: true})
    } catch (error) {
      if (/** @type {{code?: string}} */ (error)?.code === "ENOENT") return
      throw error
    }

    const watcher = this.watchFactory(resolvedDirectoryPath, (eventType, fileName) => {
      void this.onWatcherEvent({
        directoryPath: resolvedDirectoryPath,
        eventType,
        fileName
      })
    })

    watcher.on("error", this.onWatcherError)
    this.watchers.set(resolvedDirectoryPath, watcher)

    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      await this.watchDirectoryRecursive(path.join(resolvedDirectoryPath, entry.name))
    }
  }

  /**
   * @param {object} args - Options object.
   * @param {string} args.directoryPath - Watched directory path.
   * @param {string} args.eventType - Watch event type.
   * @param {string | Buffer | null} args.fileName - Relative changed filename.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async onWatcherEvent({directoryPath, eventType, fileName}) {
    const changedPath = fileName
      ? path.join(directoryPath, fileName.toString())
      : directoryPath

    await this.watchPotentialDirectory(changedPath)

    if (!this.shouldReloadPath(changedPath)) return

    this.scheduleReload(changedPath)

    await this.logger.debug(() => ["Queued development hot reload", {changedPath, eventType}])
  }

  /**
   * @param {string} changedPath - Changed path.
   * @returns {boolean} - Whether the path should trigger reload.
   */
  shouldReloadPath(changedPath) {
    const extension = path.extname(changedPath).toLowerCase()

    return RELOADABLE_EXTENSIONS.has(extension)
  }

  /**
   * @param {string} changedPath - Candidate directory path.
   * @returns {Promise<void>} - Resolves when any new directory watchers are added.
   */
  async watchPotentialDirectory(changedPath) {
    try {
      const stat = await this.stat(changedPath)

      if (stat.isDirectory()) {
        await this.watchDirectoryRecursive(changedPath)
      }
    } catch (error) {
      if (/** @type {{code?: string}} */ (error)?.code !== "ENOENT") {
        throw error
      }
    }
  }

  /**
   * @param {string} changedPath - Changed path.
   * @returns {void} - No return value.
   */
  scheduleReload(changedPath) {
    this.pendingChangedPath = changedPath

    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer)
    }

    this.reloadTimer = setTimeout(() => {
      void this.flushReload()
    }, this.debounceMs)
  }

  /** @returns {Promise<void>} - Resolves when the queued reload is handled. */
  async flushReload() {
    this.reloadTimer = undefined

    const changedPath = this.pendingChangedPath

    if (!changedPath) return

    this.pendingChangedPath = undefined
    await this.onReload({changedPath})
  }

  /**
   * @param {Error} error - Watcher error.
   * @returns {void} - No return value.
   */
  onWatcherError = (error) => {
    void this.logger.warn("Development hot reload watcher error", error)
  }

  /** @returns {Promise<void>} - Resolves when watchers are closed. */
  async stop() {
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer)
      this.reloadTimer = undefined
    }

    this.pendingChangedPath = undefined

    for (const watcher of this.watchers.values()) {
      watcher.close()
    }

    this.watchers.clear()
  }
}
