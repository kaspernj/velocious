import DatabaseMigrateFromRequireContext from "./migrate-from-require-context.js"
import React from "react"
import useEnvSense from "env-sense/src/use-env-sense.js"

import Configuration from "../configuration.js"
import restArgsError from "../utils/rest-args-error.js"

const loadMigrations = function loadMigrations({migrationsRequireContext, ...restArgs}) {
  const instance = React.useMemo(() => ({running: false}), [])
  const {isServer} = useEnvSense()
  const [loaded, setLoaded] = React.useState(false)

  const loadDatabase = React.useCallback(async () => {
    instance.running = true

    try {
      await Configuration.current().withConnections(async () => {
        const databaseMigrateFromRequireContext = new DatabaseMigrateFromRequireContext()

        await databaseMigrateFromRequireContext.execute(migrationsRequireContext)
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

export default loadMigrations
