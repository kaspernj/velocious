// @ts-check

import {describe, expect, it} from "../../../src/testing/test.js"
import {counterCacheParentUpdateHarness} from "../../helpers/counter-cache-parent-update-harness.js"

describe("database records - counter-cache parent update transaction semantics", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("waits for the outer commit before delivering a parent update", async () => {
    const {broadcasts, invokeCounterUpdate, sourceConnection} = await counterCacheParentUpdateHarness()

    await sourceConnection.transaction(async () => {
      await invokeCounterUpdate()
      expect(broadcasts).toEqual([])
    })

    expect(broadcasts.map(({body}) => body)).toEqual([{action: "update", id: 7, model: "CounterCacheParent"}])
  })

  it("discards a parent update when the surrounding transaction rolls back", async () => {
    const {broadcasts, invokeCounterUpdate, parentFindConditions, sourceConnection} = await counterCacheParentUpdateHarness()
    const rollbackError = new Error("ROLL_BACK_COUNTER_CACHE")

    try {
      await sourceConnection.transaction(async () => {
        await invokeCounterUpdate()
        throw rollbackError
      })
    } catch (error) {
      expect(error).toBe(rollbackError)
    }

    expect(parentFindConditions).toEqual([{id: 7}])
    expect(broadcasts).toEqual([])
  })

  it("discards a failed retry attempt and delivers only the committed attempt", async () => {
    const {broadcasts, invokeCounterUpdate, parentFindConditions, sourceConnection} = await counterCacheParentUpdateHarness()
    let attempts = 0

    await sourceConnection.transaction(async () => {
      attempts++
      await invokeCounterUpdate()

      if (attempts == 1) throw new Error("COUNTER_CACHE_PARENT_RETRY")
    })

    expect(attempts).toEqual(2)
    expect(parentFindConditions).toEqual([{id: 7}, {id: 7}, {id: 7}])
    expect(broadcasts.map(({body}) => body)).toEqual([{action: "update", id: 7, model: "CounterCacheParent"}])
  })

  it("leaves a nested counter update owned by its caller transaction", async () => {
    const {broadcasts, invokeCounterUpdate, sourceConnection} = await counterCacheParentUpdateHarness()

    await sourceConnection.transaction(async () => {
      await sourceConnection.transaction(async () => {
        await invokeCounterUpdate()
      })

      expect(broadcasts).toEqual([])
    })

    expect(broadcasts.map(({body}) => body)).toEqual([{action: "update", id: 7, model: "CounterCacheParent"}])
  })

  it("delivers immediately when the source record has no transaction", async () => {
    const {broadcasts, invokeCounterUpdate, parentFindConditions} = await counterCacheParentUpdateHarness()

    await invokeCounterUpdate()

    expect(parentFindConditions).toEqual([{id: 7}, {id: 7}])
    expect(broadcasts.map(({body}) => body)).toEqual([{action: "update", id: 7, model: "CounterCacheParent"}])
  })

  it("does not coalesce committed updates for the same parent", async () => {
    const {broadcasts, invokeCounterUpdate, parentFindConditions, sourceConnection} = await counterCacheParentUpdateHarness()

    await sourceConnection.transaction(async () => {
      await invokeCounterUpdate()
      await invokeCounterUpdate()
    })

    expect(parentFindConditions).toEqual([{id: 7}, {id: 7}, {id: 7}, {id: 7}])
    expect(broadcasts.map(({body}) => body)).toEqual([
      {action: "update", id: 7, model: "CounterCacheParent"},
      {action: "update", id: 7, model: "CounterCacheParent"}
    ])
  })
})
