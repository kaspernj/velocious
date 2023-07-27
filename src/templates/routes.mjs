import {Routes} from "velocious"

const routes = new Routes()

routes.draw((route) => {
  route.resources("tasks", (route) => {
    route.get("users")
  })
})

export default {routes}
