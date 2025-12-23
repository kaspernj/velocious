// @ts-check

import ResourceRoute from "../../src/routes/resource-route.js"
import singularizeModelName from "../../src/utils/singularize-model-name.js"
import * as inflection from "inflection"
import {describe, expect, it} from "../../src/testing/test.js"

describe("routes - resource route", async () => {
  it("does not include query parameters in the id", async () => {
    const route = new ResourceRoute({name: "partners/events"})
    /** @type {Record<string, any>} */
    const params = {}
    const request = /** @type {import("../../src/http-server/client/request.js").default} */ ({
      httpMethod: () => "GET"
    })

    const result = route.matchWithPath({
      params,
      path: "partners/events/123?token=abc",
      request
    })

    const singularName = singularizeModelName("partners/events")
    const singularAttributeName = inflection.camelize(inflection.underscore(singularName), true)
    const idVarName = `${singularAttributeName}Id`

    expect(params.id).toBe("123")
    expect(params[idVarName]).toBe("123")
    expect(params.action).toBe("show")
    expect(result?.restPath).toBe("")
  })
})
