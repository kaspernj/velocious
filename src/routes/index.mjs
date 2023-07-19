import RootRoute from "./root-route.mjs"

export default class VelociousRoutes {
  rootRoute = new RootRoute()

  draw(callback) {
    callback(this.rootRoute)
  }
}
