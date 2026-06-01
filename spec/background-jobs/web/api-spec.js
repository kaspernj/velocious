// @ts-check

import BackgroundJobsStore from "../../../src/background-jobs/store.js"
import Configuration from "../../../src/configuration.js"
import Dummy from "../../dummy/index.js"
import dummyConfiguration from "../../dummy/src/config/configuration.js"
import dummyDirectory from "../../dummy/dummy-directory.js"
import EnvironmentHandlerNode from "../../../src/environment-handlers/node.js"
import fetch from "node-fetch"
import Request from "../../../src/http-server/client/request.js"
import Response from "../../../src/http-server/client/response.js"
import RoutesResolver from "../../../src/routes/resolver.js"
import VelociousBackgroundJobsApi from "../../../src/background-jobs/web/index.js"
import {describe, expect, it} from "../../../src/testing/test.js"

const API_BASE = "http://localhost:3006/velocious/jobs/api"
const TOKEN = "test-jobs-token"

/**
 * Seeds a known set of jobs (2 queued + 1 failed) for assertions.
 * @returns {Promise<{failedId: string}>} - Seeded ids.
 */
async function seedJobs() {
  dummyConfiguration.setCurrent()

  const store = new BackgroundJobsStore({configuration: dummyConfiguration})

  await store.clearAll()
  await store.enqueue({jobName: "TestJob", args: ["alpha"], options: {forked: false}})
  await store.enqueue({jobName: "TestJob", args: ["beta"], options: {forked: false}})

  const failedId = await store.enqueue({jobName: "FailingJob", args: ["b"], options: {forked: false, maxRetries: 0}})
  const handedOffAtMs = await store.markHandedOff({jobId: failedId, workerId: "worker-1"})

  await store.markFailed({error: "boom", handedOffAtMs, jobId: failedId, workerId: "worker-1"})

  return {failedId}
}

/**
 * @param {object} args - Options.
 * @param {string} args.at - Mount prefix.
 * @returns {Configuration} - A throwaway configuration for resolver-level tests.
 */
function buildResolverConfiguration({at}) {
  const configuration = new Configuration({
    database: {test: {}},
    directory: dummyDirectory(),
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode(),
    initializeModels: async () => {},
    locale: "en",
    localeFallbacks: {en: ["en"]},
    locales: ["en"],
    logging: {console: true, file: false, levels: ["info", "warn", "error"]}
  })

  VelociousBackgroundJobsApi.mountInto({at, configuration})

  return configuration
}

/**
 * Resolves a single GET request through the routes resolver and returns the response.
 * @param {object} args - Options.
 * @param {Configuration} args.configuration - Configuration.
 * @param {string} args.path - Request path.
 * @param {string} args.remoteAddress - Client remote address.
 * @returns {Promise<Response>} - The populated response.
 */
async function resolveGet({configuration, path, remoteAddress}) {
  const client = {remoteAddress}
  const request = new Request({client, configuration})
  const response = new Response({configuration})
  const donePromise = new Promise((resolve) => request.requestParser.events.on("done", resolve))
  const requestLines = [`GET ${path} HTTP/1.1`, "Host: example.com", "", ""].join("\r\n")

  let previousConfiguration

  try {
    previousConfiguration = Configuration.current()
  } catch {
    // No current configuration yet.
  }

  configuration.setCurrent()

  try {
    request.feed(Buffer.from(requestLines, "utf8"))
    await donePromise

    const resolver = new RoutesResolver({configuration, request, response})

    await resolver.resolve()
  } finally {
    if (previousConfiguration) previousConfiguration.setCurrent()
  }

  return response
}

describe("Background jobs - web API", {databaseCleaning: {transaction: true}}, () => {
  it("requires authentication", async () => {
    await Dummy.run(async () => {
      await seedJobs()

      const response = await fetch(`${API_BASE}/stats`)

      expect(response.status).toEqual(401)
    })
  })

  it("returns status counts when given a valid token", async () => {
    await Dummy.run(async () => {
      await seedJobs()

      const response = await fetch(`${API_BASE}/stats`, {headers: {Authorization: `Bearer ${TOKEN}`}})
      const body = await response.json()

      expect(response.status).toEqual(200)
      expect(body.counts.queued).toEqual(2)
      expect(body.counts.failed).toEqual(1)
      expect(body.counts.handed_off).toEqual(0)
      expect(body.total).toEqual(3)
    })
  })

  it("authorizes through the host-supplied authorize callback", async () => {
    await Dummy.run(async () => {
      await seedJobs()

      const response = await fetch(`${API_BASE}/stats`, {headers: {"x-jobs-allow": "yes"}})

      expect(response.status).toEqual(200)
    })
  })

  it("rejects an invalid token", async () => {
    await Dummy.run(async () => {
      await seedJobs()

      const response = await fetch(`${API_BASE}/stats`, {headers: {Authorization: "Bearer wrong-token"}})

      expect(response.status).toEqual(401)
    })
  })

  it("lists jobs filtered by status", async () => {
    await Dummy.run(async () => {
      await seedJobs()

      const response = await fetch(`${API_BASE}/jobs?status=failed`, {headers: {Authorization: `Bearer ${TOKEN}`}})
      const body = await response.json()

      expect(response.status).toEqual(200)
      expect(body.jobs.length).toEqual(1)
      expect(body.jobs[0].jobName).toEqual("FailingJob")
      expect(body.jobs[0].status).toEqual("failed")
      expect(body.pagination.total).toEqual(1)
    })
  })

  it("returns a single job with its error detail", async () => {
    await Dummy.run(async () => {
      const {failedId} = await seedJobs()

      const response = await fetch(`${API_BASE}/jobs/${failedId}`, {headers: {Authorization: `Bearer ${TOKEN}`}})
      const body = await response.json()

      expect(response.status).toEqual(200)
      expect(body.job.id).toEqual(failedId)
      expect(body.job.status).toEqual("failed")
      expect(body.job.attempts).toEqual(1)
      expect(body.job.args).toEqual(["b"])
      expect(body.job.lastError.includes("boom")).toEqual(true)
    })
  })

  it("returns 404 for a missing job", async () => {
    await Dummy.run(async () => {
      await seedJobs()

      const response = await fetch(`${API_BASE}/jobs/does-not-exist`, {headers: {Authorization: `Bearer ${TOKEN}`}})

      expect(response.status).toEqual(404)
    })
  })

  it("exposes a health check", async () => {
    await Dummy.run(async () => {
      const response = await fetch(`${API_BASE}/health`, {headers: {Authorization: `Bearer ${TOKEN}`}})
      const body = await response.json()

      expect(response.status).toEqual(200)
      expect(body.ok).toEqual(true)
    })
  })

  it("falls back to loopback-only access when no auth is configured", async () => {
    const configuration = buildResolverConfiguration({at: "/velocious/jobs-open"})

    const loopbackResponse = await resolveGet({configuration, path: "/velocious/jobs-open/api/health", remoteAddress: "127.0.0.1"})

    expect(loopbackResponse.getStatusCode()).toEqual(200)
    expect(JSON.parse(loopbackResponse.getBody()).ok).toEqual(true)

    const remoteResponse = await resolveGet({configuration, path: "/velocious/jobs-open/api/health", remoteAddress: "203.0.113.5"})

    expect(remoteResponse.getStatusCode()).toEqual(401)
  })
})
