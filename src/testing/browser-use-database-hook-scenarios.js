// @ts-check

import React, { act } from "react"
import {createRoot} from "react-dom/client"

import Configuration, {CurrentConfigurationNotSetError} from "../configuration.js"
import BrowserEnvironmentHandler from "../environment-handlers/browser.js"
import Migration from "../database/migration/index.js"
import SingleMultiUsePool from "../database/pool/single-multi-use.js"
import SqliteWebDriver from "../database/drivers/sqlite/index.web.js"
import TenantHandle from "../tenants/tenant-handle.js"
import useDatabase from "../database/use-database.js"

/**
 * Returns the current configuration without requiring one to exist.
 * @returns {Configuration | undefined} - Current configuration when installed.
 */
function currentConfigurationOrUndefined() {
  try {
    return Configuration.current()
  } catch (error) {
    if (!(error instanceof CurrentConfigurationNotSetError)) throw error

    return undefined
  }
}

/**
 * Builds the scoped browser configuration used by the real hook scenario.
 * @returns {Configuration} - Browser test configuration.
 */
function buildHookConfiguration() {
  return new Configuration({
    database: {
      test: {
        projectTenant: {
          driver: SqliteWebDriver,
          getConnection: async () => { throw new Error("Hook scenario must not open a physical database") },
          migrations: true,
          name: "use-database-hook-template",
          poolType: SingleMultiUsePool,
          tenantOnly: true,
          type: "sqlite"
        }
      }
    },
    directory: "/use-database-hook-scenario",
    environment: "test",
    environmentHandler: new BrowserEnvironmentHandler(),
    initializeModels: async () => {},
    locale: "en",
    localeFallbacks: {en: ["en"]},
    locales: ["en"],
    tenantDatabaseResolver: ({identifier, tenant}) => {
      if (identifier !== "projectTenant" || !tenant || typeof tenant !== "object") return

      return {name: `use-database-hook-${String(/** @type {{slug?: string}} */ (tenant).slug)}`}
    }
  })
}

/**
 * Flushes real React hook transitions and reports synchronous selection state,
 * inline loader stability, and stale completion suppression.
 * @returns {Promise<{firstChangedLoaded: boolean, initialLoaded: boolean, loaderCalls: string[], loadedAfterInlineLoaderRerender: boolean, thirdAfterStaleCompletion: {error: string | null, loaded: boolean}}>} - Render observations.
 */
export default async function runUseDatabaseSelectionTransitionScenario() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  /** @type {{error: string | null, loaded: boolean, selection: "first" | "second" | "third"}[]} */
  const renders = []
  /** @type {string[]} */
  const loaderCalls = []
  /**
   * Releases the deliberately stale second initialization.
   * @type {() => void}
   */
  let releaseSecondInitialization = () => {}
  const secondInitializationRelease = new Promise((resolve) => { releaseSecondInitialization = () => resolve(undefined) })
  /**
   * Signals that the deliberately stale second initialization started.
   * @type {() => void}
   */
  let signalSecondInitialization = () => {}
  const secondInitializationStarted = new Promise((resolve) => { signalSecondInitialization = () => resolve(undefined) })

  class HookTenantHandle extends TenantHandle {
    /**
     * Runs test initialization without touching a physical database.
     * @param {{migrations: import("../database/migrator/types.js").RequireMigrationContextType}} args - Hook initialization arguments.
     * @returns {Promise<Readonly<ReturnType<TenantHandle["inspect"]>>>} - Ready test snapshot.
     */
    async initialize({migrations}) {
      loaderCalls.push(migrations.id)

      if (this.tenant().slug === "second") {
        signalSecondInitialization()
        await secondInitializationRelease
        throw new Error("SECOND_SELECTION_FAILED")
      }

      return Object.freeze({databaseIdentifier: "projectTenant", dirty: false, lastUsed: 0, pinCount: 0, ready: true, schemaGeneration: "generation-1", state: "open"})
    }
  }
  const previousConfiguration = currentConfigurationOrUndefined()
  const restorationConfiguration = previousConfiguration || buildHookConfiguration()
  const configuration = buildHookConfiguration()

  configuration.setCurrent()

  const firstHandle = new HookTenantHandle({configuration, tenant: {slug: "first"}})
  const secondHandle = new HookTenantHandle({configuration, tenant: {slug: "second"}})
  const thirdHandle = new HookTenantHandle({configuration, tenant: {slug: "third"}})
  const renderCounts = {first: 0, second: 0, third: 0}

  /**
   * Runs hook probe.
   * @param {{selection: "first" | "second" | "third", tenantHandle: HookTenantHandle}} props - Probe props.
   * @returns {React.ReactElement} - Empty host element.
   */
  function HookProbe({selection, tenantHandle}) {
    const state = useDatabase({
      databaseIdentifier: "projectTenant",
      migrationsRequireContextCallback: async () => {
        /**
         * Looks up an empty migration context entry recreated by every probe render.
         * @param {string} fileName - Requested migration file.
         * @returns {{default: typeof Migration}} - Placeholder migration module.
         * @type {import("../database/migrator/types.js").RequireMigrationContextType}
         */
        const emptyMigrations = (fileName) => {
          if (!fileName) throw new Error("Migration context lookup requires a file name")

          return {default: Migration}
        }

        emptyMigrations.keys = () => []
        emptyMigrations.id = selection

        return emptyMigrations
      },
      schemaGeneration: "generation-1",
      tenantHandle
    })

    renderCounts[selection]++
    if (renderCounts[selection] > 20) throw new Error(`useDatabase render loop for ${selection}`)
    renders.push({error: state.error?.message || null, loaded: state.loaded, selection})

    return React.createElement("div")
  }

  try {
    await act(async () => {
      root.render(React.createElement(HookProbe, {selection: "first", tenantHandle: firstHandle}))
    })

    const initialRender = renders.at(-1)

    await act(async () => {
      root.render(React.createElement(HookProbe, {selection: "first", tenantHandle: firstHandle}))
    })

    const loadedAfterInlineLoaderRerender = renders.at(-1)?.loaded

    act(() => {
      root.render(React.createElement(HookProbe, {selection: "second", tenantHandle: secondHandle}))
    })

    const firstChangedRender = renders.find((render) => render.selection === "second")
    await secondInitializationStarted

    await act(async () => {
      root.render(React.createElement(HookProbe, {selection: "third", tenantHandle: thirdHandle}))
    })

    releaseSecondInitialization()
    await act(async () => { await secondInitializationRelease })

    const thirdAfterStaleCompletion = renders.at(-1)

    if (!initialRender || !firstChangedRender || !thirdAfterStaleCompletion || loadedAfterInlineLoaderRerender === undefined) {
      throw new Error("useDatabase hook scenario did not render every selection")
    }

    return {
      firstChangedLoaded: firstChangedRender.loaded,
      initialLoaded: initialRender.loaded,
      loaderCalls,
      loadedAfterInlineLoaderRerender,
      thirdAfterStaleCompletion: {
        error: thirdAfterStaleCompletion.error,
        loaded: thirdAfterStaleCompletion.loaded
      }
    }
  } finally {
    releaseSecondInitialization()
    await act(async () => { root.unmount() })
    container.remove()
    restorationConfiguration.setCurrent()
    await configuration.closeDatabaseConnections()
  }
}
