// @ts-check

import BasicRoute from "./basic-route.js"

export default class VelociousRootRoute extends BasicRoute {
  getHumanPaths() {
    return [
      {method: "GET", action: "index", path: "/"}
    ]
  }
}
