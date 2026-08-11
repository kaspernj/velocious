// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import {websocketUrlFromHttpBase} from "../../src/http-client/websocket-url-from-http-base.js"

describe("websocketUrlFromHttpBase", () => {
  it("builds a secure websocket URL from an https base", () => {
    expect(websocketUrlFromHttpBase("https://ticketserver.example.com")).toEqual("wss://ticketserver.example.com/websocket")
  })

  it("builds a plain websocket URL from an http base", () => {
    expect(websocketUrlFromHttpBase("http://127.0.0.1:5203")).toEqual("ws://127.0.0.1:5203/websocket")
  })
})
