// @ts-check

import {fileURLToPath} from "node:url"

const RAMPWAY_DEPLOYMENT_TOKEN = "test-rampway-deployment-token"

const rampwayDeploymentConfig = {
  accessTokens: [RAMPWAY_DEPLOYMENT_TOKEN],
  at: "/rampway/deployments",
  databaseIdentifier: "default",
  projects: {
    "velocious-dummy": {
      stages: {
        test: {
          configPath: fileURLToPath(new URL("../../rampway.config.mjs", import.meta.url)),
          releaseBranch: "master"
        }
      }
    }
  },
  staleRunTimeoutMs: 2000,
  workerBootstrapPath: fileURLToPath(new URL("./rampway-deployment-worker.js", import.meta.url))
}

export {RAMPWAY_DEPLOYMENT_TOKEN}
export default rampwayDeploymentConfig
