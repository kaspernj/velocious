// @ts-check

import React from "react"
import useEnvSense from "env-sense/build/use-env-sense.js"

import Configuration from "../configuration.js"
import Migrator from "./migrator.js"
import restArgsError from "../utils/rest-args-error.js"

/**
 * @param {object} args
 * @param {() => Promise<import("./migrator/types.js").RequireMigrationContextType>} args.migrationsRequireContextCallback
 * @returns {{loaded: boolean}}
 */
export default function loadMigrations({migrationsRequireContextCallback, ...restArgs}) {
  const instance = React.useMemo(() => ({running: false}), [])
  const {isServer} = useEnvSense()
  const [loaded, setLoaded] = React.useState(false)

  const loadDatabase = React.useCallback(async () => {
    instance.running = true

    try {
      await Configuration.current().ensureConnections(async () => {
        const migrator = new Migrator({configuration: Configuration.current()})

        await migrator.prepare()
        await migrator.migrateFilesFromRequireContext(await migrationsRequireContextCallback())
      })

      await Configuration.current().initialize()
      setLoaded(true)
    } finally {
      instance.running = false
    }
  }, [])

  React.useMemo(() => {
    if (!loaded && !isServer && !instance.running) {
      loadDatabase()
    }
  }, [loaded])

  restArgsError(restArgs)

  return {loaded}
}
