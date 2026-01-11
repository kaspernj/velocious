import {describe, expect, it} from "../../src/testing/test.js"
import EventEmitter from "../../src/utils/event-emitter.js"

describe("event-emitter wrapper", () => {
  it("constructs and emits events", () => {
    const emitter = new EventEmitter()
    let received = null

    emitter.on("ping", (payload) => {
      received = payload
    })

    emitter.emit("ping", "ok")

    expect(received).toEqual("ok")
  })
})
