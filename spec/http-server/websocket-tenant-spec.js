// @ts-check

import Configuration from "../../src/configuration.js"
import Current from "../../src/current.js"
import EventEmitter from "../../src/utils/event-emitter.js"
import WebsocketChannel from "../../src/http-server/websocket-channel.js"
import WebsocketRequest from "../../src/http-server/client/websocket-request.js"
import WebsocketSession from "../../src/http-server/client/websocket-session.js"
import {describe, expect, it} from "../../src/testing/test.js"
import {createTenantTestConfiguration, seedTenantValue} from "../helpers/tenant-test-helpers.js"

class TenantChannel extends WebsocketChannel {
  /** @returns {Promise<void>} */
  async subscribed() {
    await this.streamFrom("tenant-events")

    const tenant = /** @type {{slug?: string} | undefined} */ (Current.tenant())
    const dbs = this.configuration.getCurrentConnections()
    const defaultRows = await dbs.default.query("SELECT value FROM tenant_values LIMIT 1")
    const analyticsRows = await dbs.analytics.query("SELECT value FROM tenant_values LIMIT 1")

    this.websocketSession.sendJson({
      analyticsValue: analyticsRows[0]?.value,
      tenantSlug: tenant?.slug,
      type: "tenant-ready",
      value: defaultRows[0]?.value
    })
  }

  /**
   * @param {{channel: string, payload: any}} args - Event args.
   * @returns {Promise<void>} - Resolves when complete.
   */
  async receivedBroadcast({channel, payload}) {
    const tenant = /** @type {{slug?: string} | undefined} */ (Current.tenant())
    const dbs = this.configuration.getCurrentConnections()
    const defaultRows = await dbs.default.query("SELECT value FROM tenant_values LIMIT 1")

    this.websocketSession.sendJson({
      channel,
      payload,
      tenantSlug: tenant?.slug,
      type: "tenant-event",
      value: defaultRows[0]?.value
    })
  }
}

describe("HttpServer - websocket tenant", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("runs subscription callbacks and event delivery inside the resolved tenant context", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("velocious-websocket-tenant")
    let previousConfiguration

    try {
      try {
        previousConfiguration = Configuration.current()
      } catch {
        // Ignore missing current configuration.
      }

      configuration.setCurrent()
      configuration.setWebsocketChannelResolver(async ({subscription}) => {
        if (subscription?.channel === "tenant-channel") {
          return TenantChannel
        }
      })

      await seedTenantValue(configuration, "default", "alpha", "alpha-default")
      await seedTenantValue(configuration, "analytics", "alpha", "alpha-analytics")
      const messages = []
      const session = new WebsocketSession({
        client: {events: new EventEmitter(), remoteAddress: "127.0.0.1"},
        configuration,
        upgradeRequest: new WebsocketRequest({method: "GET", path: "/websocket", remoteAddress: "127.0.0.1"})
      })

      session.sendJson = (body) => {
        messages.push(body)
      }

      await session._handleChannelSubscription({channel: "tenant-channel", params: {project_slug: "alpha"}})
      await session.sendEvent("tenant-events", {kind: "ping"})

      expect(messages).toEqual([
        {channel: "tenant-events", type: "subscribed"},
        {
          analyticsValue: "alpha-analytics",
          tenantSlug: "alpha",
          type: "tenant-ready",
          value: "alpha-default"
        },
        {
          channel: "tenant-events",
          payload: {kind: "ping"},
          tenantSlug: "alpha",
          type: "tenant-event",
          value: "alpha-default"
        }
      ])
    } finally {
      previousConfiguration?.setCurrent()
      await cleanup()
    }
  })
})
