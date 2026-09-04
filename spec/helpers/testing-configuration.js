// @ts-check

import Configuration from "../../src/configuration.js"
import EnvironmentHandlerNode from "../../src/environment-handlers/node.js"
import repoRoot from "./repo-root.js"

/**
 * Builds the minimal framework configuration for runner characterization.
 * @returns {Configuration} - Framework configuration.
 */
export default function buildTestingConfiguration() {
  return new Configuration({
    database: {test: {}},
    directory: repoRoot(),
    environment: "test",
    environmentHandler: new EnvironmentHandlerNode(),
    initializeModels: async () => {},
    locale: "en",
    localeFallbacks: {en: ["en"]},
    locales: ["en"]
  })
}
