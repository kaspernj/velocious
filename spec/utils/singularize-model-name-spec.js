import {describe, expect, it} from "../../src/testing/test.js"
import singularizeModelName from "../../src/utils/singularize-model-name.js"

describe("singularizeModelName", () => {
  it("handles multi-words correctly", () => {
    const singularizedEventSeries = singularizeModelName("EventSeries")

    expect(singularizedEventSeries).toEqual("EventSeries")
  })

  it("handles single-words correctly", () => {
    const singularizedEventSeries = singularizeModelName("AccountUsers")

    expect(singularizedEventSeries).toEqual("AccountUser")
  })
})
