// @ts-check

import {fileURLToPath} from "node:url"
import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import Client from "../../src/http-server/client/index.js"
import VelociousHttpServerClientResponse from "../../src/http-server/client/response.js"

/**
 * FakeRequest type.
 * @typedef {object} FakeRequest
 * @property {(headerName: string) => string | undefined} header - Case-insensitive header lookup.
 * @property {() => string} httpMethod - HTTP method.
 * @property {() => string} httpVersion - HTTP version.
 */

/**
 * Resolves a real file in the repository to back sendFile delivery specs; the test runner's
 * working directory is the dummy app, so paths must anchor on this file instead.
 * @returns {string} - Absolute path to the repository package.json file.
 */
export function repositoryPackageJsonPath() {
  return fileURLToPath(new URL("../../package.json", import.meta.url))
}

/**
 * Builds a minimal client test configuration without database access.
 * @param {object} [args] - Options object.
 * @param {boolean | import("../../src/configuration-types.js").HttpCompressionConfiguration} [args.compression] - HTTP compression configuration.
 * @returns {Configuration} - Minimal configuration.
 */
export function buildConfiguration({compression} = {}) {
  return new Configuration({
    database: {test: {}},
    directory: process.cwd(),
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode(),
    httpServer: compression === undefined ? {} : {compression},
    initializeModels: async () => {},
    locale: "en",
    localeFallbacks: {en: ["en"]},
    locales: ["en"],
    logging: {console: false, file: false}
  })
}

/**
 * Builds a fake request with case-insensitive header lookup.
 * @param {object} [args] - Options object.
 * @param {Record<string, string>} [args.headers] - Request headers.
 * @param {string} [args.httpMethod] - HTTP method.
 * @returns {FakeRequest} - Fake request shaped like a parsed request.
 */
export function buildRequest({headers = {}, httpMethod = "GET"} = {}) {
  /** @type {Record<string, string>} */
  const lowerCaseHeaders = {}

  for (const [key, value] of Object.entries(headers)) {
    lowerCaseHeaders[key.toLowerCase()] = value
  }

  return {
    header: (headerName) => lowerCaseHeaders[headerName.toLowerCase()],
    httpMethod: () => httpMethod,
    httpVersion: () => "1.1"
  }
}

/**
 * Builds a real response with a buffered body and common headers.
 * @param {object} args - Options object.
 * @param {Configuration} args.configuration - Configuration instance.
 * @param {string | Uint8Array} args.body - Buffered response body.
 * @param {string} [args.contentType] - Content-Type header value.
 * @param {Record<string, string>} [args.headers] - Additional response headers.
 * @param {number} [args.status] - HTTP status code.
 * @returns {VelociousHttpServerClientResponse} - Response instance.
 */
export function buildResponse({body, configuration, contentType = "text/html; charset=UTF-8", headers = {}, status}) {
  const response = new VelociousHttpServerClientResponse({configuration})

  if (status !== undefined) response.setStatus(status)
  if (contentType) response.setHeader("Content-Type", contentType)

  for (const [key, value] of Object.entries(headers)) {
    response.setHeader(key, value)
  }

  response.setBody(body)

  return response
}

/**
 * Builds a minimal request-runner test double around a real response so sendResponse can be exercised in isolation.
 * @param {object} args - Options object.
 * @param {VelociousHttpServerClientResponse} args.response - Response instance to deliver.
 * @param {FakeRequest} [args.request] - Fake request.
 * @returns {import("../../src/http-server/client/request-runner.js").default} - Runner test double narrowed to the surface sendResponse touches.
 */
export function buildRequestRunner({request = buildRequest(), response}) {
  // Test double: only the surface sendResponse touches is provided, so narrow it to the real runner type.
  const runner = /** @type {unknown} */ ({
    response,
    getRequest: () => request,
    getState: () => "done",
    logCompletedRequest: async () => {}
  })

  return /** @type {import("../../src/http-server/client/request-runner.js").default} */ (runner)
}

/**
 * Delivers a response through a real client and captures the emitted output chunks.
 * @param {object} args - Options object.
 * @param {Configuration} args.configuration - Configuration instance.
 * @param {VelociousHttpServerClientResponse} args.response - Response to deliver.
 * @param {FakeRequest} [args.request] - Fake request.
 * @returns {Promise<{client: Client, outputs: Array<string | Uint8Array>}>} - Client and captured output chunks.
 */
export async function deliverResponse({configuration, request, response}) {
  const client = new Client({clientCount: 1, configuration})

  /** @type {Array<string | Uint8Array>} */
  const outputs = []

  client.events.on("output", (data) => {
    outputs.push(data)
  })

  await client.sendResponse(buildRequestRunner({request, response}))

  return {client, outputs}
}

/**
 * Reads the emitted header block.
 * @param {Array<string | Uint8Array>} outputs - Captured output chunks.
 * @returns {string} - Header block including the status line.
 */
export function headerText(outputs) {
  return /** @type {string} */ (outputs[0])
}

/**
 * Concatenates the emitted body chunks into a single buffer.
 * @param {Array<string | Uint8Array>} outputs - Captured output chunks.
 * @returns {Buffer} - Body bytes.
 */
export function bodyBuffer(outputs) {
  const chunks = outputs.slice(1).map((chunk) => typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk)

  return Buffer.concat(chunks)
}
