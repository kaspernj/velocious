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
  /** @returns {boolean} */
  canSubscribe() { return true }

  /** @returns {Promise<void>} */
  async subscribed() {
    const tenant = /** @type {{slug?: string} | undefined} */ (Current.tenant())
    const configuration = this.session.configuration
    const dbs = configuration.getCurrentConnections()
    const defaultRows = await dbs.default.query("SELECT value FROM tenant_values LIMIT 1")
    const analyticsRows = await dbs.analytics.query("SELECT value FROM tenant_values LIMIT 1")

    this.session.sendJson({
      analyticsValue: analyticsRows[0]?.value,
      tenantSlug: tenant?.slug,
      type: "tenant-ready",
      value: defaultRows[0]?.value
    })
  }

  /**
   * @param {Record<string, any>} broadcastParams
   * @returns {boolean}
   */
  matches(broadcastParams) {
    return broadcastParams?.channel === "tenant-events"
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
      configuration.registerWebsocketChannel("tenant-channel", TenantChannel)

      await seedTenantValue(configuration, "default", "alpha", "alpha-default")
      await seedTenantValue(configuration, "analytics", "alpha", "alpha-analytics")
      /** @type {Record<string, any>[]} */
      const messages = []
      const session = new WebsocketSession({
        client: /** @type {any} */ ({events: new EventEmitter(), remoteAddress: "127.0.0.1"}),
        configuration,
        upgradeRequest: new WebsocketRequest({method: "GET", path: "/websocket", remoteAddress: "127.0.0.1"})
      })

      session.sendJson = (/** @type {Record<string, any>} */ body) => {
        messages.push(body)
      }

      // Subscribe via the new channel-subscribe message handler.
      await session._handleChannelSubscribe({
        type: "channel-subscribe",
        channelType: "tenant-channel",
        subscriptionId: "s1",
        params: {project_slug: "alpha"}
      })

      expect(messages.some((m) => m.type === "channel-subscribed")).toBe(true)
      expect(messages.some((m) => m.type === "tenant-ready")).toBe(true)

      const readyMessage = messages.find((m) => m.type === "tenant-ready")

      expect(readyMessage?.tenantSlug).toEqual("alpha")
      expect(readyMessage?.value).toEqual("alpha-default")
      expect(readyMessage?.analyticsValue).toEqual("alpha-analytics")
    } finally {
      if (previousConfiguration) {
        previousConfiguration.setCurrent()
      }

      await cleanup()
    }
  })
})
