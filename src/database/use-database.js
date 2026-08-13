// @ts-check

import React from "react"
import useEnvSense from "env-sense/build/use-env-sense.js"

import Configuration from "../configuration.js"
import Migrator from "./migrator.js"
import restArgsError from "../utils/rest-args-error.js"

/**
 * Initializes either the legacy ambient frontend database or one immutable
 * tenant-bound physical database generation.
 * @param {object} args - Initialization options.
 * @param {import("../configuration.js").default} args.configuration - Current frontend configuration.
 * @param {string} [args.databaseIdentifier] - Tenant-only logical database identifier.
 * @param {() => Promise<import("./migrator/types.js").RequireMigrationContextType>} args.migrationsRequireContextCallback - Migrations loader.
 * @param {string} [args.schemaGeneration] - Tenant schema generation.
 * @param {import("../tenants/tenant-handle.js").default} [args.tenantHandle] - Immutable tenant handle.
 * @returns {Promise<void>} - Resolves when the selected database is ready.
 */
export async function initializeFrontendDatabase({configuration, databaseIdentifier, migrationsRequireContextCallback, schemaGeneration, tenantHandle}) {
  if (tenantHandle) {
    tenantHandle.assertConfiguration(configuration)
    if (!databaseIdentifier) throw new Error("Tenant frontend database initialization requires databaseIdentifier")
    if (!schemaGeneration) throw new Error("Tenant frontend database initialization requires schemaGeneration")

    await tenantHandle.initialize({
      databaseIdentifier,
      migrations: await migrationsRequireContextCallback(),
      schemaGeneration
    })
    await configuration.initialize()
    return
  }
  if (databaseIdentifier || schemaGeneration) {
    throw new Error("Tenant frontend database initialization requires tenantHandle")
  }

  await configuration.ensureConnections({name: "React database migration loader"}, async () => {
    const migrator = new Migrator({configuration})

    await migrator.prepare()
    await migrator.migrateFilesFromRequireContext(await migrationsRequireContextCallback())
  })

  await configuration.initialize()
}

/**
 * React lifecycle hook for frontend database readiness. With `tenantHandle`,
 * readiness follows that immutable physical tenant plus `schemaGeneration`;
 * changing either cancels the stale render result without cancelling shared
 * lifecycle work needed by another caller.
 * @param {object} args - Hook options.
 * @param {string} [args.databaseIdentifier] - Tenant-only logical database identifier.
 * @param {() => Promise<import("./migrator/types.js").RequireMigrationContextType>} args.migrationsRequireContextCallback - Migrations loader.
 * @param {string} [args.schemaGeneration] - Tenant schema generation.
 * @param {import("../tenants/tenant-handle.js").default} [args.tenantHandle] - Immutable tenant handle.
 * @returns {{error: Error | null, loaded: boolean}} - Selected database readiness.
 */
export default function useDatabase({databaseIdentifier, migrationsRequireContextCallback, schemaGeneration, tenantHandle, ...restArgs}) {
  restArgsError(restArgs)

  const {isServer} = useEnvSense()
  const selection = React.useMemo(() => ({databaseIdentifier, migrationsRequireContextCallback, schemaGeneration, tenantHandle}), [databaseIdentifier, migrationsRequireContextCallback, schemaGeneration, tenantHandle])
  const [state, setState] = React.useState({error: /** @type {Error | null} */ (null), loaded: false, selection})

  React.useEffect(() => {
    if (isServer) return undefined

    let current = true
    const configuration = Configuration.current()

    setState({error: null, loaded: false, selection})
    void initializeFrontendDatabase({
      configuration,
      databaseIdentifier,
      migrationsRequireContextCallback,
      schemaGeneration,
      tenantHandle
    }).then(() => {
      if (current) setState({error: null, loaded: true, selection})
    }, (error) => {
      if (current) setState({error: error instanceof Error ? error : new Error(String(error)), loaded: false, selection})
    })

    return () => { current = false }
  }, [isServer, selection])

  if (state.selection !== selection) return {error: null, loaded: false}

  return {error: state.error, loaded: state.loaded}
}
