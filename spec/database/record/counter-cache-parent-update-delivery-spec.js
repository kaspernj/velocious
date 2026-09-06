// @ts-check

import {describe, expect, it} from "../../../src/testing/test.js"
import {counterCacheParentUpdateHarness} from "../../helpers/counter-cache-parent-update-harness.js"

describe("database records - counter-cache parent update delivery", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("does not reload a parent when no listener is registered", async () => {
    const {broadcasts, invokeCounterUpdate, parentFindConditions} = await counterCacheParentUpdateHarness({registerPublisher: false})

    await invokeCounterUpdate()

    expect(parentFindConditions).toEqual([])
    expect(broadcasts).toEqual([])
  })

  it("silently skips a parent that disappeared before delivery", async () => {
    const {broadcasts, invokeCounterUpdate, parentFindConditions} = await counterCacheParentUpdateHarness({missingParent: true})

    await invokeCounterUpdate()

    expect(parentFindConditions).toEqual([{id: 7}, {id: 7}])
    expect(broadcasts).toEqual([])
  })

  it("delivers the complete committed parent record to the publisher", async () => {
    const {broadcasts, invokeCounterUpdate} = await counterCacheParentUpdateHarness({
      parentAttributes: {counterCacheChildrenCount: 3, id: 7, name: "Committed parent"},
      previousParentAttributes: {counterCacheChildrenCount: 2, id: 7, name: "Previous parent"},
      primaryKey: ["id", "counterCacheChildrenCount"]
    })

    await invokeCounterUpdate()

    expect(broadcasts.map(({body}) => body)).toEqual([{
      action: "update",
      id: {counterCacheChildrenCount: 3, id: 7},
      model: "CounterCacheParent",
      previousId: {counterCacheChildrenCount: 2, id: 7}
    }])
  })

  it("reports reload failures without rejecting the committed source operation", async () => {
    const reloadError = new Error("COUNTER_CACHE_PARENT_RELOAD_FAILED")
    const {allErrors, frameworkErrors, invokeCounterUpdate, sourceConnection} = await counterCacheParentUpdateHarness({findError: reloadError})

    await sourceConnection.transaction(async () => {
      await invokeCounterUpdate()
    })

    expect(frameworkErrors).toEqual([{
      context: {stage: "counter-cache-parent-update-after-commit"},
      error: reloadError
    }])
    expect(allErrors).toEqual([{
      context: {stage: "counter-cache-parent-update-after-commit"},
      error: reloadError,
      errorType: "framework-error"
    }])
  })

  it("reports publisher failures without rejecting the committed source operation", async () => {
    const publisherError = new Error("COUNTER_CACHE_PARENT_PUBLISH_FAILED")
    const {allErrors, frameworkErrors, invokeCounterUpdate, sourceConnection} = await counterCacheParentUpdateHarness({broadcastError: publisherError})

    await sourceConnection.transaction(async () => {
      await invokeCounterUpdate()
    })

    expect(frameworkErrors).toEqual([{
      context: {stage: "counter-cache-parent-update-after-commit"},
      error: publisherError
    }])
    expect(allErrors).toEqual([{
      context: {stage: "counter-cache-parent-update-after-commit"},
      error: publisherError,
      errorType: "framework-error"
    }])
  })
})
