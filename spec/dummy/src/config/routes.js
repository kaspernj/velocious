import Routes from "../../../../src/routes/index.js"

const routes = new Routes()

routes.draw((route) => {
  route.namespace("api", (route) => {
    route.post("version")
  })

  route.resources("projects", (route) => {
    route.resources("tasks", (route) => {
      route.get("custom")
    })
  })

  route.resources("tasks", (route) => {
    route.get("users")
  })

  route.get("ping")
})

export default {routes}
