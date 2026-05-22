// @ts-check

import {matchJobsApiPath, normalizeMountPrefix} from "../../../src/background-jobs/web/path-matcher.js"
import {describe, expect, it} from "../../../src/testing/test.js"

describe("Background jobs - web path matcher", () => {
  it("matches API paths under a normal mount prefix", () => {
    expect(matchJobsApiPath({method: "GET", path: "/velocious/jobs/api/stats", prefix: "/velocious/jobs"})).toEqual({action: "stats", params: {}})
    expect(matchJobsApiPath({method: "GET", path: "/velocious/jobs/api/jobs/abc-123", prefix: "/velocious/jobs"})).toEqual({action: "show", params: {id: "abc-123"}})
  })

  it("matches API paths under a root mount", () => {
    const prefix = normalizeMountPrefix("/")

    expect(prefix).toEqual("/")
    expect(matchJobsApiPath({method: "GET", path: "/api/health", prefix})).toEqual({action: "health", params: {}})
    expect(matchJobsApiPath({method: "GET", path: "/api/jobs", prefix})).toEqual({action: "index", params: {}})
  })

  it("ignores paths outside the mount and the bare mount root", () => {
    expect(matchJobsApiPath({method: "GET", path: "/something-else/api/stats", prefix: "/velocious/jobs"})).toEqual(null)
    expect(matchJobsApiPath({method: "GET", path: "/velocious/jobs", prefix: "/velocious/jobs"})).toEqual(null)
    expect(matchJobsApiPath({method: "POST", path: "/velocious/jobs/api/stats", prefix: "/velocious/jobs"})).toEqual(null)
  })
})
