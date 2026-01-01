import dummyConfiguration from "./configuration.js"
import TestWebsocketChannel from "../channels/test-websocket-channel.js"

const queryParam = (request, key) => {
  const pathValue = request?.path?.()
  const query = pathValue?.split("?")[1]

  if (!query) return

  return new URLSearchParams(query).get(key) || undefined
}

export default async function configureTesting() {
  dummyConfiguration.setWebsocketSubscriptionFilters([
    ({channel, request}) => {
      if (!channel.startsWith("protected:")) return true

      const token = request?.params?.()?.token || queryParam(request, "token")

      return token === "allow"
    }
  ])

  dummyConfiguration.setWebsocketEventFilters([
    ({channel, request}) => {
      if (!channel.startsWith("filtered:")) return true

      const token = request?.params?.()?.eventToken || queryParam(request, "eventToken")

      return token === "allow"
    }
  ])

  dummyConfiguration.setWebsocketChannelResolver(({request}) => {
    const channel = queryParam(request, "channel")

    if (channel === "test") return TestWebsocketChannel
  })

  beforeEach(async ({testArgs}) => {
    const transaction = testArgs.databaseCleaning?.transaction

    if (transaction === undefined) {
      const dbs = dummyConfiguration.getCurrentConnections()

      for (const dbIdentifier in dbs) {
        const db = dbs[dbIdentifier]

        await db.startTransaction()
      }
    }
  })

  afterEach(async ({testArgs}) => {
    const transaction = testArgs.databaseCleaning?.transaction
    const truncate = testArgs.databaseCleaning?.truncate

    const dbs = dummyConfiguration.getCurrentConnections()

    for (const dbIdentifier in dbs) {
      const db = dbs[dbIdentifier]

      if (transaction === undefined || transaction) {
        await db.rollbackTransaction()
      }

      if (truncate) {
        await db.truncateAllTables()
      }
    }
  })
}
