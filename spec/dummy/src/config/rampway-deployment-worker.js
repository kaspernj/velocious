// @ts-check

import configurationResolver from "../../../../src/configuration-resolver.js"
import dummyDirectory from "../../dummy-directory.js"

/** @returns {Promise<{configuration: import("../../../../src/configuration.js").default}>} - Worker context. */
export default async function createRampwayDeploymentWorkerContext() {
  return {
    configuration: await configurationResolver({directory: dummyDirectory()})
  }
}
