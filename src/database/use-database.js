import DatabaseMigrateFromRequireContext from "./migrate-from-require-context.js"
import React from "react"
import useEnvSense from "env-sense/src/use-env-sense.js"

import Configuration from "../configuration.js"
import restArgsError from "../utils/rest-args-error.js"

const shared = {
  loaded: false
}

const loadMigrations = function loadMigrations({migrationsRequireContext, ...restArgs}) {
  const {isServer} = useEnvSense()
  const [loaded, setLoaded] = React.useState(shared.loaded)

  const loadDatabase = React.useCallback(async () => {
    await Configuration.current().getDatabasePool().withConnection(async () => {
      const databaseMigrateFromRequireContext = new DatabaseMigrateFromRequireContext()

      await databaseMigrateFromRequireContext.execute(migrationsRequireContext)
    })

    await Configuration.current().initialize()

    shared.loaded = true
    setLoaded(true)
  }, [])

  React.useMemo(() => {
    if (!loaded && !isServer) {
      loadDatabase()
    }
  }, [loaded])

  restArgsError(restArgs)

  return {loaded}
}

export default loadMigrations
