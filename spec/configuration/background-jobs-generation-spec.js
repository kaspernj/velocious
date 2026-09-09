// @ts-check

import path from "node:path"
import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import BackgroundJobsMain from "../../src/background-jobs/main.js"
import { createGenerationWorkerId, parseGenerationWorkerId, resolveGenerationId } from "../../src/background-jobs/generation-identity.js"
import { describe, expect, it } from "../../src/testing/test.js"

const GENERATION_ENV_KEYS = [
  "VELOCIOUS_BACKGROUND_JOBS_GENERATION_ID",
  "VELOCIOUS_BACKGROUND_JOBS_INITIAL_GENERATION_STATE",
  "VELOCIOUS_BACKGROUND_JOBS_LIFECYCLE_SOCKET_PATH"
]

/**
 * @param {import("../../src/configuration-types.js").BackgroundJobsConfiguration} [backgroundJobs] - Background-jobs configuration.
 * @returns {Configuration} - Isolated configuration.
 */
function buildConfiguration(backgroundJobs) {
  return new Configuration({
    backgroundJobs,
    directory: process.cwd(),
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode(),
    initializeModels: async () => {},
    locale: "en",
    localeFallbacks: {en: ["en"]}
  })
}

/**
 * Runs assertions with isolated generation-related environment variables.
 * @param {Record<string, string | undefined>} values - Temporary values.
 * @param {() => void | Promise<void>} callback - Assertions.
 * @returns {Promise<void>}
 */
async function withGenerationEnvironment(values, callback) {
  const previous = Object.fromEntries(GENERATION_ENV_KEYS.map((key) => [key, process.env[key]]))

  for (const key of GENERATION_ENV_KEYS) delete process.env[key]
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) process.env[key] = value
  }

  try {
    await callback()
  } finally {
    for (const key of GENERATION_ENV_KEYS) {
      const value = previous[key]

      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
}

describe("Background jobs generation configuration", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("preserves exact legacy defaults when generation mode is unset", async () => {
    await withGenerationEnvironment({}, () => {
      const config = buildConfiguration().getBackgroundJobsConfig()

      expect(config.generationId).toEqual(undefined)
      expect(config.initialGenerationState).toEqual("active")
      expect(config.lifecycleSocketPath).toEqual(undefined)
    })
  })

  it("resolves identical config and environment identity with candidate default", async () => {
    const socketPath = path.join(process.cwd(), "tmp", "background-jobs-main.sock")

    await withGenerationEnvironment({
      VELOCIOUS_BACKGROUND_JOBS_GENERATION_ID: "release-20260828.1",
      VELOCIOUS_BACKGROUND_JOBS_LIFECYCLE_SOCKET_PATH: socketPath
    }, () => {
      const config = buildConfiguration({
        generationId: "release-20260828.1",
        lifecycleSocketPath: socketPath
      }).getBackgroundJobsConfig()

      expect(config.generationId).toEqual("release-20260828.1")
      expect(config.initialGenerationState).toEqual("candidate")
      expect(config.lifecycleSocketPath).toEqual(socketPath)
    })
  })

  it("accepts explicit active and retired recovery states", async () => {
    await withGenerationEnvironment({}, () => {
      expect(buildConfiguration({generationId: "release-a", initialGenerationState: "active"}).getBackgroundJobsConfig().initialGenerationState).toEqual("active")
      expect(buildConfiguration({generationId: "release-a", initialGenerationState: "retired"}).getBackgroundJobsConfig().initialGenerationState).toEqual("retired")
    })
  })

  it("does not treat the implicit candidate default as an explicit API source", async () => {
    await withGenerationEnvironment({}, () => {
      const configuration = buildConfiguration({generationId: "release-api"})

      expect(new BackgroundJobsMain({configuration, initialGenerationState: "active"}).initialGenerationState).toEqual("active")
      expect(new BackgroundJobsMain({configuration, initialGenerationState: "retired"}).initialGenerationState).toEqual("retired")
    })
  })

  it("requires actual config, environment, and API recovery-state sources to agree", async () => {
    await withGenerationEnvironment({
      VELOCIOUS_BACKGROUND_JOBS_GENERATION_ID: "release-api",
      VELOCIOUS_BACKGROUND_JOBS_INITIAL_GENERATION_STATE: "active"
    }, async () => {
      const agreeing = buildConfiguration({generationId: "release-api", initialGenerationState: "active"})
      expect(new BackgroundJobsMain({configuration: agreeing, generationId: "release-api", initialGenerationState: "active"}).initialGenerationState).toEqual("active")

      await expect(() => new BackgroundJobsMain({
        configuration: agreeing,
        generationId: "release-api",
        initialGenerationState: "retired"
      })).toThrow(/conflict/i)
    })
  })

  it("fails loudly for empty, malformed, overlong, and wrong-type identities", async () => {
    await withGenerationEnvironment({}, async () => {
      for (const generationId of ["", " release", "release:one", "release/one", "a".repeat(129), 42]) {
        await expect(() => buildConfiguration(/** @type {import("../../src/configuration-types.js").BackgroundJobsConfiguration} */ ({generationId})).getBackgroundJobsConfig()).toThrow(/generation/i)
      }
    })

    await withGenerationEnvironment({VELOCIOUS_BACKGROUND_JOBS_GENERATION_ID: ""}, async () => {
      await expect(() => buildConfiguration().getBackgroundJobsConfig()).toThrow(/generation/i)
    })
  })

  it("rejects conflicting identities and lifecycle states across sources", async () => {
    await withGenerationEnvironment({
      VELOCIOUS_BACKGROUND_JOBS_GENERATION_ID: "release-b",
      VELOCIOUS_BACKGROUND_JOBS_INITIAL_GENERATION_STATE: "active"
    }, async () => {
      await expect(() => buildConfiguration({generationId: "release-a"}).getBackgroundJobsConfig()).toThrow(/conflict/i)
      await expect(() => buildConfiguration({generationId: "release-b", initialGenerationState: "retired"}).getBackgroundJobsConfig()).toThrow(/conflict/i)
    })
  })

  it("rejects generation lifecycle settings without a generation", async () => {
    await withGenerationEnvironment({}, async () => {
      await expect(() => buildConfiguration({initialGenerationState: "candidate"}).getBackgroundJobsConfig()).toThrow(/generation/i)
      await expect(() => buildConfiguration({lifecycleSocketPath: path.join(process.cwd(), "tmp", "main.sock")}).getBackgroundJobsConfig()).toThrow(/generation/i)
    })
  })

  it("rejects invalid lifecycle state and non-absolute socket paths", async () => {
    await withGenerationEnvironment({}, async () => {
      await expect(() => buildConfiguration(/** @type {import("../../src/configuration-types.js").BackgroundJobsConfiguration} */ ({generationId: "release-a", initialGenerationState: "starting"})).getBackgroundJobsConfig()).toThrow(/initialGenerationState/)
      await expect(() => buildConfiguration({generationId: "release-a", lifecycleSocketPath: "tmp/main.sock"}).getBackgroundJobsConfig()).toThrow(/absolute/)
    })
  })

  it("centralizes API identity conflicts and the maximum durable worker owner", async () => {
    expect(() => resolveGenerationId([
      {name: "configuration", present: true, value: "release-a"},
      {name: "API", present: true, value: "release-b"}
    ])).toThrow(/conflict/i)

    const generationId = `r${"a".repeat(127)}`
    const workerInstanceId = "7e725e43-1887-4f19-a711-4731fe6caab2"
    const workerId = createGenerationWorkerId({generationId, workerInstanceId})

    expect(workerId.length).toEqual(165)
    expect(parseGenerationWorkerId(workerId)).toEqual({generationId, workerInstanceId})
    expect(parseGenerationWorkerId(`${generationId}:not-a-uuid`)).toEqual(null)
  })
})
