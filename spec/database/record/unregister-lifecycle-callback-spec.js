// @ts-check

import {describe, expect, it} from "../../../src/testing/test.js"
import VelociousDatabaseRecord from "../../../src/database/record/index.js"

describe("database - record - unregister lifecycle callback", () => {
  it("removes a registered lifecycle callback", () => {
    class CallbackModel extends VelociousDatabaseRecord {}

    const callback = async () => {}

    CallbackModel.afterUpdate(callback)

    expect(CallbackModel.getLifecycleCallbacksMap().afterUpdate.length).toEqual(1)

    CallbackModel.unregisterLifecycleCallback("afterUpdate", callback)

    expect(CallbackModel.getLifecycleCallbacksMap().afterUpdate.length).toEqual(0)
  })

  it("ignores callbacks that were never registered", () => {
    class CallbackModel extends VelociousDatabaseRecord {}

    CallbackModel.unregisterLifecycleCallback("afterUpdate", async () => {})

    expect(CallbackModel.getLifecycleCallbacksMap().afterUpdate).toEqual(undefined)
  })
})
