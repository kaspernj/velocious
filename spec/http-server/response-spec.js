// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import VelociousHttpServerClientResponse from "../../src/http-server/client/response.js"

const stubConfiguration = /** @type {any} */ ({})

describe("VelociousHttpServerClientResponse#setStatus", () => {
  it("accepts the existing named aliases", () => {
    const response = new VelociousHttpServerClientResponse({configuration: stubConfiguration})

    response.setStatus("success")
    expect(response.getStatusCode()).toEqual(200)
    expect(response.getStatusMessage()).toEqual("OK")

    response.setStatus("not-found")
    expect(response.getStatusCode()).toEqual(404)
    expect(response.getStatusMessage()).toEqual("Not Found")

    response.setStatus("internal-server-error")
    expect(response.getStatusCode()).toEqual(500)
    expect(response.getStatusMessage()).toEqual("Internal server error")
  })

  it("accepts arbitrary numeric HTTP status codes with their standard reason phrases", () => {
    const response = new VelociousHttpServerClientResponse({configuration: stubConfiguration})

    response.setStatus(201)
    expect(response.getStatusCode()).toEqual(201)
    expect(response.getStatusMessage()).toEqual("Created")

    response.setStatus(204)
    expect(response.getStatusCode()).toEqual(204)
    expect(response.getStatusMessage()).toEqual("No Content")

    response.setStatus(401)
    expect(response.getStatusCode()).toEqual(401)
    expect(response.getStatusMessage()).toEqual("Unauthorized")

    // The status code that originally motivated this change.
    response.setStatus(422)
    expect(response.getStatusCode()).toEqual(422)
    expect(response.getStatusMessage()).toEqual("Unprocessable Entity")

    response.setStatus(503)
    expect(response.getStatusCode()).toEqual(503)
    expect(response.getStatusMessage()).toEqual("Service Unavailable")
  })

  it("accepts numeric strings for codes from the standard range", () => {
    const response = new VelociousHttpServerClientResponse({configuration: stubConfiguration})

    response.setStatus("422")
    expect(response.getStatusCode()).toEqual(422)
    expect(response.getStatusMessage()).toEqual("Unprocessable Entity")
  })

  it("falls back to OK as the message when an unknown numeric code in range is provided", () => {
    const response = new VelociousHttpServerClientResponse({configuration: stubConfiguration})

    response.setStatus(299)
    expect(response.getStatusCode()).toEqual(299)
    expect(response.getStatusMessage()).toEqual("OK")
  })

  it("rejects values outside the 1xx-5xx range", () => {
    const response = new VelociousHttpServerClientResponse({configuration: stubConfiguration})

    expect(() => response.setStatus(99)).toThrow("Unhandled status: 99")
    expect(() => response.setStatus(600)).toThrow("Unhandled status: 600")
    expect(() => response.setStatus("teapot")).toThrow("Unhandled status: teapot")
  })

  it("returns the standard reason phrase for HTTP 305 Use Proxy", () => {
    const response = new VelociousHttpServerClientResponse({configuration: stubConfiguration})

    response.setStatus(305)
    expect(response.getStatusCode()).toEqual(305)
    expect(response.getStatusMessage()).toEqual("Use Proxy")
  })
})
