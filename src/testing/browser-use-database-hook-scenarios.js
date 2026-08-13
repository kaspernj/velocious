// @ts-check

import React, { act } from "react"
import {createRoot} from "react-dom/client"

import Configuration from "../configuration.js"
import Migration from "../database/migration/index.js"
import TenantHandle from "../tenants/tenant-handle.js"
import useDatabase from "../database/use-database.js"

/**
 * Flushes one real React hook selection transition and reports the first render
 * for the new selection, before its passive effect can establish readiness.
 * @returns {Promise<{firstChangedLoaded: boolean, firstRenderAfterError: {error: string | null, loaded: boolean}, initialLoaded: boolean}>} - Render observations.
 */
export default async function runUseDatabaseSelectionTransitionScenario() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  /** @type {{error: string | null, loaded: boolean, selection: "first" | "second" | "third"}[]} */
  const renders = []
  /**
   * Runs empty migrations context lookup.
   * @param {string} fileName - Requested migration module.
   * @returns {{default: typeof Migration}} - Placeholder migration module.
   */
  function emptyMigrations(fileName) {
    if (!fileName) throw new Error("Migration context lookup requires a file name")

    return {default: Migration}
  }

  emptyMigrations.keys = () => []
  emptyMigrations.id = "use-database-hook-scenario"
  const migrationsRequireContextCallback = async () => emptyMigrations

  class HookTenantHandle extends TenantHandle {
    /**
     * Runs test initialization without touching a physical database.
     * @returns {Promise<Readonly<ReturnType<TenantHandle["inspect"]>>>} - Ready test snapshot.
     */
    async initialize() {
      return Object.freeze({databaseIdentifier: "projectTenant", dirty: false, lastUsed: 0, pinCount: 0, ready: true, schemaGeneration: "generation-1", state: "open"})
    }
  }
  const configuration = Configuration.current()
  const firstHandle = new HookTenantHandle({configuration, tenant: {slug: "first"}})
  class FailingHookTenantHandle extends HookTenantHandle {
    /**
     * Rejects initialization for the stale-error transition.
     * @returns {Promise<never>} - Always rejects.
     */
    async initialize() {
      throw new Error("SECOND_SELECTION_FAILED")
    }
  }
  const secondHandle = new FailingHookTenantHandle({configuration, tenant: {slug: "second"}})
  const thirdHandle = new HookTenantHandle({configuration, tenant: {slug: "third"}})

  /**
   * Runs hook probe.
   * @param {{selection: "first" | "second" | "third", tenantHandle: HookTenantHandle}} props - Probe props.
   * @returns {React.ReactElement} - Empty host element.
   */
  function HookProbe({selection, tenantHandle}) {
    const state = useDatabase({
      databaseIdentifier: "projectTenant",
      migrationsRequireContextCallback,
      schemaGeneration: "generation-1",
      tenantHandle
    })

    renders.push({error: state.error?.message || null, loaded: state.loaded, selection})

    return React.createElement("div")
  }

  try {
    await act(async () => {
      root.render(React.createElement(HookProbe, {selection: "first", tenantHandle: firstHandle}))
    })

    const initialRender = renders.at(-1)

    await act(async () => {
      root.render(React.createElement(HookProbe, {selection: "second", tenantHandle: secondHandle}))
    })

    const firstChangedRender = renders.find((render) => render.selection === "second")

    await act(async () => {
      root.render(React.createElement(HookProbe, {selection: "third", tenantHandle: thirdHandle}))
    })

    const firstRenderAfterError = renders.find((render) => render.selection === "third")

    if (!initialRender || !firstChangedRender || !firstRenderAfterError) throw new Error("useDatabase hook scenario did not render every selection")

    return {
      firstChangedLoaded: firstChangedRender.loaded,
      firstRenderAfterError: {
        error: firstRenderAfterError.error,
        loaded: firstRenderAfterError.loaded
      },
      initialLoaded: initialRender.loaded
    }
  } finally {
    await act(async () => { root.unmount() })
    container.remove()
  }
}
