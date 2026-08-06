import os from "node:os"
import path from "node:path"
import {fileURLToPath} from "node:url"

const repositoryPath = fileURLToPath(new URL("../../", import.meta.url))

export default {
  application: "velocious-dummy",
  stages: {
    test: {
      branch: "master",
      deployTo: path.join(os.tmpdir(), "velocious-rampway-dummy-deployments"),
      healthChecks: [{name: "package", path: "package.json"}],
      linkedDirs: [],
      linkedFiles: [],
      repo: repositoryPath,
      runtime: {type: "none"},
      strategy: "remote-git",
      tasks: {},
      transport: {type: "local"}
    }
  }
}
