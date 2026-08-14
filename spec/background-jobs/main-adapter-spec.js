// @ts-check

import BackgroundJobsMain from "../../src/background-jobs/main.js"
import BackgroundJobsClient from "../../src/background-jobs/client.js"
import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import SqlBackgroundJobsAdapter from "../../src/background-jobs/sql-adapter.js"
import BackgroundJobsTestAdapter from "../helpers/background-jobs-test-adapter.js"
import {describe, expect, it} from "../../src/testing/test.js"

describe("Background jobs - main adapter", () => {
  it("keeps the Node SQL persistence and TCP producer defaults", () => {
    const environmentHandler = new EnvironmentHandlerNode()
    const configuration = new Configuration({
      directory: process.cwd(),
      environment: "test",
      environmentHandler,
      initializeModels: async () => {},
      locale: "en",
      localeFallbacks: {en: ["en"]}
    })
    const main = new BackgroundJobsMain({configuration})

    expect(main.adapter).toBeUndefined()
    expect(configuration.getBackgroundJobsAdapter()).toBeInstanceOf(SqlBackgroundJobsAdapter)
    expect(environmentHandler.backgroundJobsClient({configuration})).toBeInstanceOf(BackgroundJobsClient)
  })

  it("uses the configured adapter as its persistence seam", () => {
    const adapter = new BackgroundJobsTestAdapter()
    const configuration = new Configuration({
      backgroundJobs: {adapter},
      directory: process.cwd(),
      environment: "test",
      environmentHandler: new EnvironmentHandlerNode(),
      initializeModels: async () => {},
      locale: "en",
      localeFallbacks: {en: ["en"]}
    })
    const main = new BackgroundJobsMain({configuration})

    expect(main.adapter).toBeUndefined()
    expect(configuration.getBackgroundJobsAdapter()).toEqual(adapter)
    expect(configuration.getEnvironmentHandler().backgroundJobsClient({configuration})).toBeInstanceOf(BackgroundJobsClient)
  })
})
