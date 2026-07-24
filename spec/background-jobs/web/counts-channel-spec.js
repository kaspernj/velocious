// @ts-check

import BackgroundJobCountsChannel from "../../../src/background-jobs/web/counts-channel.js"
import Configuration from "../../../src/configuration.js"
import EnvironmentHandlerNode from "../../../src/environment-handlers/node.js"
import {registerJobsMount} from "../../../src/background-jobs/web/registry.js"
import {describe, expect, it} from "../../../src/testing/test.js"

/**
 * @returns {Configuration} Minimal configuration.
 */
function buildConfiguration() {
  return new Configuration({
    database: {test: {default: {}}},
    directory: "/tmp/velocious-background-job-count-channel-spec",
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode(),
    initializeModels: async () => {},
    locale: "en",
    locales: ["en"]
  })
}

/**
 * @param {Configuration} configuration - Configuration.
 * @param {Record<string, import("../../../src/http-server/websocket-channel.js").WebsocketJsonValue>} params - Subscription params.
 * @returns {BackgroundJobCountsChannel} Channel.
 */
function buildChannel(configuration, params) {
  const request = /** @type {import("../../../src/http-server/client/request.js").default} */ ({
    header: () => undefined,
    remoteAddress: () => "203.0.113.5"
  })
  const session = /** @type {import("../../../src/http-server/client/websocket-session.js").default} */ ({
    configuration,
    upgradeRequest: request
  })

  return new BackgroundJobCountsChannel({params, session, subscriptionId: "counts"})
}

describe("Background jobs - count websocket channel", () => {
  it("authorizes with the mount token and scopes broadcasts to its database", async () => {
    const configuration = buildConfiguration()

    registerJobsMount(configuration, "/jobs", {
      accessTokens: ["secret"],
      databaseIdentifier: "analytics"
    })
    const channel = buildChannel(configuration, {
      authenticationToken: "secret",
      mountAt: "/jobs"
    })

    expect(await channel.canSubscribe()).toEqual(true)
    expect(channel.matches({databaseIdentifier: "analytics"})).toEqual(true)
    expect(channel.matches({databaseIdentifier: "default"})).toEqual(false)
  })

  it("rejects unknown mounts and invalid tokens", async () => {
    const configuration = buildConfiguration()

    registerJobsMount(configuration, "/jobs", {accessTokens: ["secret"]})

    expect(await buildChannel(configuration, {authenticationToken: "wrong", mountAt: "/jobs"}).canSubscribe()).toEqual(false)
    expect(await buildChannel(configuration, {authenticationToken: "secret", mountAt: "/other"}).canSubscribe()).toEqual(false)
  })
})
