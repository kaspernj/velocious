import Routes from "../../../../src/routes/index.js"

const routes = new Routes()

routes.draw((route) => {
  route.resources("tasks", (route) => {
    route.get("users")
  })
})

export default {routes}
