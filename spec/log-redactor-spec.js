// @ts-check

import Configuration from "../src/configuration.js"
import EnvironmentHandlerNode from "../src/environment-handlers/node.js"
import LogRedactor, { LOG_REDACTION_MARKER } from "../src/log-redactor.js"
import RequestTiming from "../src/http-server/client/request-timing.js"
import WebsocketRequest from "../src/http-server/client/websocket-request.js"
import { describe, expect, it } from "../src/testing/test.js"

/**
 * @param {import("../src/configuration-types.js").LoggingConfiguration} [logging] - Logging configuration.
 * @returns {Configuration} - Minimal test configuration.
 */
function buildConfiguration(logging) {
  return new Configuration({
    database: {test: {}},
    directory: process.cwd(),
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode(),
    initializeModels: async () => {},
    locale: "en",
    localeFallbacks: {en: ["en"]},
    locales: ["en"],
    logging
  })
}

describe("LogRedactor", () => {
  it("matches default and extended sensitive names without hiding unrelated diagnostics", async () => {
    const secret = "SYNTHETIC_POLICY_SECRET_6993A903"
    const redactor = new LogRedactor({sensitiveNames: ["integrationPin"]})
    const redacted = redactor.redactStructured({
      API_KEY: secret,
      Authorization: secret,
      Cookie: secret,
      nested: [{AUTHENTICATION_token: secret, credential: secret, integration_pin: secret, serviceToken: secret, session_id: secret}],
      safeField: "visible-policy-value"
    })

    expect(redacted.API_KEY).toEqual(LOG_REDACTION_MARKER)
    expect(redacted.Authorization).toEqual(LOG_REDACTION_MARKER)
    expect(redacted.Cookie).toEqual(LOG_REDACTION_MARKER)
    expect(redacted.nested[0].AUTHENTICATION_token).toEqual(LOG_REDACTION_MARKER)
    expect(redacted.nested[0].credential).toEqual(LOG_REDACTION_MARKER)
    expect(redacted.nested[0].integration_pin).toEqual(LOG_REDACTION_MARKER)
    expect(redacted.nested[0].serviceToken).toEqual(LOG_REDACTION_MARKER)
    expect(redacted.nested[0].session_id).toEqual(LOG_REDACTION_MARKER)
    expect(redacted.safeField).toEqual("visible-policy-value")
  })

  it("validates application sensitive names without mutating the caller array", async () => {
    const sensitiveNames = ["integrationPin"]
    const configuration = buildConfiguration({sensitiveNames})

    sensitiveNames.push("laterName")

    expect(configuration.getLogRedactor().isSensitiveName("integration_pin")).toEqual(true)
    expect(configuration.getLogRedactor().isSensitiveName("later_name")).toEqual(false)
    expect(() => buildConfiguration(/** @type {import("../src/configuration-types.js").LoggingConfiguration} */ ({sensitiveNames: "invalid"}))).toThrow(/sensitiveNames must be an array/u)
    expect(() => buildConfiguration({sensitiveNames: [""]})).toThrow(/must not be blank/u)
  })

  it("registers bearer, cookie, query, body, and websocket parameter values", async () => {
    const bearerSecret = "SYNTHETIC_BEARER_SECRET_6993A903"
    const cookieSecret = "SYNTHETIC_COOKIE_SECRET_6993A903"
    const bodySecret = "SYNTHETIC_BODY_SECRET_6993A903"
    const querySecret = "SYNTHETIC_QUERY_SECRET_6993A903"
    const redactor = new LogRedactor()
    const request = new WebsocketRequest({
      headers: {
        Authorization: `Bearer ${bearerSecret}`,
        Cookie: `session_id=${cookieSecret}`
      },
      method: "POST",
      params: {nested: [{service_token: bodySecret}]},
      path: `/lookup?api-key=${querySecret}&visible=visible-query-value`
    })
    const values = redactor.requestSensitiveValues(request)
    const diagnostic = redactor.redactString(`auth=${bearerSecret} cookie=${cookieSecret} body=${bodySecret} query=${querySecret} safe=visible-query-value`, values)

    expect(diagnostic.includes(bearerSecret)).toEqual(false)
    expect(diagnostic.includes(cookieSecret)).toEqual(false)
    expect(diagnostic.includes(bodySecret)).toEqual(false)
    expect(diagnostic.includes(querySecret)).toEqual(false)
    expect(diagnostic).toContain(LOG_REDACTION_MARKER)
    expect(diagnostic).toContain("visible-query-value")
  })

  it("redacts sensitive query names without crashing on malformed URL encoding", async () => {
    const redactor = new LogRedactor()
    const redactedPath = redactor.redactPath("/lookup?api-key=%E0%A4%A&visible=value")

    expect(redactedPath).toEqual(`/lookup?api-key=${LOG_REDACTION_MARKER}&visible=value`)
  })

  it("redacts short structured credentials without replacing unrelated diagnostic text", async () => {
    const redactor = new LogRedactor()
    const safeDiagnostic = "SELECT 1 FROM v1_routes -- stack.js:123:45 literal=a encoded=%61 short=1234567"
    const redacted = redactor.redactStructured({
      apiKey: "a",
      normalToken: "12345678",
      password: "1234567",
      safeDiagnostic,
      sessionId: 1
    })

    expect(redacted.apiKey).toEqual(LOG_REDACTION_MARKER)
    expect(redacted.normalToken).toEqual(LOG_REDACTION_MARKER)
    expect(redacted.password).toEqual(LOG_REDACTION_MARKER)
    expect(redacted.sessionId).toEqual(LOG_REDACTION_MARKER)
    expect(redacted.safeDiagnostic).toEqual(safeDiagnostic)
    expect(redactor.redactString(safeDiagnostic, new Set(["1", "a", "%61", "1234567"]))).toEqual(safeDiagnostic)
    expect(redactor.redactString("credential=12345678", redactor.sensitiveValues({normalToken: "12345678"}))).toEqual(`credential=${LOG_REDACTION_MARKER}`)
  })

  it("keeps request-local sensitive registries isolated across concurrent contexts", async () => {
    const firstSecret = "SYNTHETIC_CONCURRENT_FIRST_6993A903"
    const secondSecret = "SYNTHETIC_CONCURRENT_SECOND_6993A903"
    const configuration = buildConfiguration()
    const redactor = configuration.getLogRedactor()

    const runRequest = async (ownSecret, otherSecret) => {
      const requestTiming = new RequestTiming()
      const request = new WebsocketRequest({method: "GET", params: {serviceToken: ownSecret}, path: "/ping"})

      return await configuration.runWithRequestTiming(requestTiming, async () => {
        requestTiming.registerLogSensitiveValues(redactor.requestSensitiveValues(request))
        await Promise.resolve()

        const currentTiming = configuration.getCurrentRequestTiming()

        if (!currentTiming) throw new Error("Missing request timing context")

        return redactor.redactString(`${ownSecret}|${otherSecret}|visible-concurrent-value`, currentTiming.getLogSensitiveValues())
      })
    }

    const [firstResult, secondResult] = await Promise.all([
      runRequest(firstSecret, secondSecret),
      runRequest(secondSecret, firstSecret)
    ])

    expect(firstResult).toContain(`${LOG_REDACTION_MARKER}|${secondSecret}|visible-concurrent-value`)
    expect(secondResult).toContain(`${LOG_REDACTION_MARKER}|${firstSecret}|visible-concurrent-value`)
  })
})
