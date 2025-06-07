import RootRoute from "./root-route.js"

export default class VelociousRoutes {
  rootRoute = new RootRoute()

  draw(callback) {
    callback(this.rootRoute)
  }
}
