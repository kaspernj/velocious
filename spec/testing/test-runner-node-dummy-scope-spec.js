// @ts-check

import Configuration from "../../src/configuration.js"
import DummyAccessScopeObserver from "./fixtures/dummy-access-scope-observer.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import {AsyncLocalStorage} from "node:async_hooks"
import {describe, expect, it} from "../../src/testing/test.js"
import {fileURLToPath} from "node:url"
import TestRunner from "../../src/testing/test-runner.js"

describe("TestRunner node Dummy access scope", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("starts persistent infrastructure outside the revocable test-attempt scope", async () => {
    const environmentHandler = new EnvironmentHandlerNode()
    const configuration = new Configuration({
      database: {test: {}},
      directory: process.cwd(),
      environment: "test",
      environmentHandler,
      initializeModels: async () => {},
      locale: "en",
      localeFallbacks: {en: ["en"]},
      locales: ["en"]
    })
    class ObservedTestRunner extends TestRunner {
      defaultDummyPath() {
        return fileURLToPath(new URL("./fixtures/dummy-access-scope-observer.js", import.meta.url))
      }
    }
    const testRunner = new ObservedTestRunner({configuration, testFiles: []})
    const accessScope = {revoked: false}
    /** @type {{revoked: boolean} | undefined} */
    let callbackScope

    environmentHandler.installTestDatabaseAccessScopeStorage(new AsyncLocalStorage())
    DummyAccessScopeObserver.setScopeCapture(() => environmentHandler.currentTestDatabaseAccessScope())
    await configuration.runWithTestDatabaseAccessScope(accessScope, async () => {
      await testRunner.runNodeDummy(async () => {
        callbackScope = environmentHandler.currentTestDatabaseAccessScope()
      })
    })

    expect(DummyAccessScopeObserver.startupScope()).toBeUndefined()
    expect(callbackScope).toBe(accessScope)
  })
})
