// @ts-check

import {createTenantTestConfiguration} from "../helpers/tenant-test-helpers.js"
import Current from "../../src/current.js"
import DatabaseRecord from "../../src/database/record/index.js"
import {configureTests, describe, expect, it, testConfig} from "../../src/testing/test.js"
import Tenant from "../../src/tenants/tenant.js"
import TestRunner from "../../src/testing/test-runner.js"

describe("TestRunner transactional tenant connections", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("registers physical tenant transactions for one attempt and rolls them back", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("test-runner-transactional-tenant")
    let previousConfiguration

    class AttemptRow extends DatabaseRecord {}

    AttemptRow.setTableName("attempt_rows")
    AttemptRow.switchesTenantDatabase("projectTenant")
    AttemptRow.registerRecordClass({configuration})

    try {
      try {
        previousConfiguration = Current.configuration()
      } catch {
        // No previous current configuration.
      }
      configuration.setCurrent()

      for (const tenant of [{slug: "alpha"}, {slug: "beta"}]) {
        await configuration.runWithTenant(tenant, async () => {
          await configuration.ensureConnections(async (dbs) => {
            await dbs.projectTenant.query("CREATE TABLE IF NOT EXISTS attempt_rows(id integer PRIMARY KEY AUTOINCREMENT, value varchar(255) NOT NULL)")
          })
        })
      }

      const runner = new TestRunner({configuration, testFiles: []})
      const alphaConnections = []
      const tests = {
        args: {},
        afterAlls: [],
        afterEaches: [],
        beforeAlls: [],
        beforeEaches: [],
        subs: {},
        tests: {
          "writes isolated tenant rows": {
            args: {databaseCleaning: {transaction: true}},
            function: async (testArgs) => {
              await testArgs.registerTransactionalTenant({databaseIdentifier: "projectTenant", tenant: {slug: "alpha"}})
              await testArgs.registerTransactionalTenant({databaseIdentifier: "projectTenant", tenant: {slug: "beta"}})

              for (let index = 0; index < 2; index++) {
                await Tenant.with({slug: "alpha"}, async (dbs) => {
                  alphaConnections.push(dbs.projectTenant)
                  if (index === 0) await AttemptRow.create({value: "alpha"})
                })
              }

              await configuration.runWithTestSharedConnectionContexts(async () => {
                await Tenant.with({slug: "alpha"}, async (dbs) => {
                  expect(dbs.projectTenant).toBe(alphaConnections[0])
                  await AttemptRow.create({value: "in-process-request"})
                })
              })

              await configuration.runWithTenant({slug: "beta"}, async () => {
                await configuration.ensureConnections(async (dbs) => {
                  expect(dbs.projectTenant).not.toBe(alphaConnections[0])
                  const rows = await dbs.projectTenant.query("SELECT value FROM attempt_rows")
                  expect(rows).toEqual([])
                  await dbs.projectTenant.query("INSERT INTO attempt_rows(value) VALUES ('beta')")
                })
              })

              await configuration.runWithTenant({slug: "unregistered"}, async () => {
                await configuration.ensureConnections(async (dbs) => {
                  expect(dbs.projectTenant).not.toBe(alphaConnections[0])
                  expect(dbs.projectTenant.insideTransaction()).toBe(false)
                })
              })

              expect(alphaConnections[1]).toBe(alphaConnections[0])
            }
          },
          "starts the next attempt without prior rows": {
            args: {databaseCleaning: {transaction: true}},
            function: async (testArgs) => {
              await testArgs.registerTransactionalTenant({databaseIdentifier: "projectTenant", tenant: {slug: "alpha"}})

              await configuration.runWithTenant({slug: "alpha"}, async () => {
                await configuration.ensureConnections(async (dbs) => {
                  const rows = await dbs.projectTenant.query("SELECT value FROM attempt_rows")
                  expect(rows).toEqual([])
                })
              })
            }
          }
        }
      }

      await runner.runTests({afterEaches: [], beforeEaches: [], descriptions: [], indentLevel: 0, tests})

      expect(runner._failedTests).toBe(0)
    } finally {
      previousConfiguration?.setCurrent()
      await cleanup()
    }
  })

  it("revokes and rolls back a registration when an attempt throws", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("test-runner-transactional-tenant-error")

    try {
      await configuration.runWithTenant({slug: "alpha"}, async () => {
        await configuration.ensureConnections(async (dbs) => {
          await dbs.projectTenant.query("CREATE TABLE attempt_rows(value varchar(255) NOT NULL)")
        })
      })

      const runner = new TestRunner({configuration, testFiles: []})
      let attempt = 0
      const tests = {
        args: {},
        afterAlls: [],
        afterEaches: [],
        beforeAlls: [],
        beforeEaches: [],
        subs: {},
        tests: {
          "throws after writing": {
            args: {databaseCleaning: {transaction: true}, retry: 1},
            function: async (testArgs) => {
              attempt++
              await testArgs.registerTransactionalTenant({databaseIdentifier: "projectTenant", tenant: {slug: "alpha"}})
              await configuration.runWithTenant({slug: "alpha"}, async () => {
                await configuration.ensureConnections(async (dbs) => {
                  const rows = await dbs.projectTenant.query("SELECT value FROM attempt_rows")
                  expect(rows).toEqual([])
                  if (attempt === 1) await dbs.projectTenant.query("INSERT INTO attempt_rows(value) VALUES ('discarded')")
                })
              })
              if (attempt === 1) throw new Error("expected attempt failure")
            }
          }
        }
      }

      await runner.runTests({afterEaches: [], beforeEaches: [], descriptions: [], indentLevel: 0, tests})
      expect(attempt).toBe(2)
      expect(runner._failedTests).toBe(0)
      expect(configuration.getDatabasePool("projectTenant").testSharedConnection()).toBeUndefined()

      await configuration.runWithTenant({slug: "alpha"}, async () => {
        await configuration.ensureConnections(async (dbs) => {
          expect(dbs.projectTenant.insideTransaction()).toBe(false)
          expect(await dbs.projectTenant.query("SELECT value FROM attempt_rows")).toEqual([])
        })
      })
    } finally {
      await cleanup()
    }
  })

  it("keeps the registered tenant transaction active through afterEach", async () => {
    const {cleanup, configuration} = await createTenantTestConfiguration("test-runner-transactional-tenant-after-each")
    const afterEachConnections = []
    let bodyConnection
    let afterEachAttempt = 0

    try {
      await configuration.runWithTenant({slug: "alpha"}, async () => {
        await configuration.ensureConnections(async (dbs) => {
          await dbs.projectTenant.query("CREATE TABLE attempt_rows(value varchar(255) NOT NULL)")
        })
      })

      const runner = new TestRunner({configuration, testFiles: []})
      const tests = {
        args: {},
        afterAlls: [],
        afterEaches: [{
          callback: async () => {
            afterEachAttempt++
            await configuration.runWithTenant({slug: "alpha"}, async () => {
              await configuration.ensureConnections(async (dbs) => {
                afterEachConnections.push(dbs.projectTenant)
                expect(dbs.projectTenant.insideTransaction()).toBe(true)
                if (afterEachAttempt === 1) {
                  expect(await dbs.projectTenant.query("SELECT value FROM attempt_rows")).toEqual([{value: "test-body"}])
                }
              })
            })
          }
        }],
        beforeAlls: [],
        beforeEaches: [],
        subs: {},
        tests: {
          "writes for afterEach inspection": {
            args: {databaseCleaning: {transaction: true}},
            function: async (testArgs) => {
              await testArgs.registerTransactionalTenant({databaseIdentifier: "projectTenant", tenant: {slug: "alpha"}})
              await configuration.runWithTenant({slug: "alpha"}, async () => {
                await configuration.ensureConnections(async (dbs) => {
                  bodyConnection = dbs.projectTenant
                  await dbs.projectTenant.query("INSERT INTO attempt_rows(value) VALUES ('test-body')")
                })
              })
            }
          },
          "starts without the prior attempt row": {
            args: {databaseCleaning: {transaction: true}},
            function: async (testArgs) => {
              await testArgs.registerTransactionalTenant({databaseIdentifier: "projectTenant", tenant: {slug: "alpha"}})
              await configuration.runWithTenant({slug: "alpha"}, async () => {
                await configuration.ensureConnections(async (dbs) => {
                  expect(await dbs.projectTenant.query("SELECT value FROM attempt_rows")).toEqual([])
                })
              })
            }
          }
        }
      }

      await runner.runTests({afterEaches: [], beforeEaches: [], descriptions: [], indentLevel: 0, tests})

      expect(runner._failedTests).toBe(0)
      expect(afterEachConnections[0]).toBe(bodyConnection)
    } finally {
      await cleanup()
    }
  })

  it("emergency-cleans a transactional tenant whose timed-out lifecycle remains pending", async () => {
    const previousTimeoutSeconds = testConfig.defaultTimeoutSeconds
    const {cleanup, configuration} = await createTenantTestConfiguration("test-runner-transactional-tenant-timeout")
    const pool = configuration.getDatabasePool("projectTenant")
    let resumeTimedOutBody = () => {}
    let markStaleQueryComplete = () => {}
    const timedOutBodySignal = new Promise((resolve) => {
      resumeTimedOutBody = resolve
    })
    const staleQueryComplete = new Promise((resolve) => {
      markStaleQueryComplete = resolve
    })
    let staleQueryError
    let timedOutConnection
    let successorConnection

    try {
      await configuration.runWithTenant({slug: "alpha"}, async () => {
        await configuration.ensureConnections(async (dbs) => {
          await dbs.projectTenant.query("CREATE TABLE attempt_rows(value varchar(255) NOT NULL)")
        })
      })
      configureTests({defaultTimeoutSeconds: 1})

      const runner = new TestRunner({configuration, testFiles: []})
      const tests = {
        args: {},
        afterAlls: [],
        afterEaches: [],
        beforeAlls: [],
        beforeEaches: [],
        subs: {},
        tests: {
          "times out while holding an uncommitted tenant row": {
            args: {databaseCleaning: {transaction: true}, timeoutSeconds: 0.01},
            function: async (testArgs) => {
              await testArgs.registerTransactionalTenant({databaseIdentifier: "projectTenant", tenant: {slug: "alpha"}})
              await configuration.runWithTenant({slug: "alpha"}, async () => {
                await configuration.ensureConnections(async (dbs) => {
                  timedOutConnection = dbs.projectTenant
                  await dbs.projectTenant.query("INSERT INTO attempt_rows(value) VALUES ('timed-out')")
                  await timedOutBodySignal
                  try {
                    await dbs.projectTenant.query("INSERT INTO attempt_rows(value) VALUES ('stale-resumed')")
                  } catch (error) {
                    staleQueryError = error
                  } finally {
                    markStaleQueryComplete()
                  }
                })
              })
            }
          },
          "does not inherit the timed-out tenant registration": {
            args: {databaseCleaning: {transaction: true}},
            function: async (testArgs) => {
              expect(pool.testSharedConnection()).toBeUndefined()
              expect(pool.getDebugSnapshot().inUseCount).toBe(0)
              await testArgs.registerTransactionalTenant({databaseIdentifier: "projectTenant", tenant: {slug: "alpha"}})
              await configuration.runWithTenant({slug: "alpha"}, async () => {
                await configuration.ensureConnections(async (dbs) => {
                  successorConnection = dbs.projectTenant
                  expect(await dbs.projectTenant.query("SELECT value FROM attempt_rows")).toEqual([])
                  resumeTimedOutBody()
                  await staleQueryComplete
                  expect(successorConnection).not.toBe(timedOutConnection)
                  expect(staleQueryError).toBeDefined()
                  expect(await dbs.projectTenant.query("SELECT value FROM attempt_rows")).toEqual([])
                })
              })
            }
          }
        }
      }

      await runner.runTests({afterEaches: [], beforeEaches: [], descriptions: [], indentLevel: 0, tests})
      resumeTimedOutBody()
      await staleQueryComplete

      expect(pool.testSharedConnection()).toBeUndefined()
      expect(pool.getDebugSnapshot().inUseCount).toBe(0)
      expect(runner._failedTests).toBe(1)
    } finally {
      resumeTimedOutBody()
      configureTests({defaultTimeoutSeconds: previousTimeoutSeconds})
      await cleanup()
    }
  })
})
