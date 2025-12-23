import Routes from "../../../../src/routes/index.js"

const routes = new Routes()

routes.draw((route) => {
  route.namespace("api", (route) => {
    route.post("broadcast-event")
    route.post("version")
  })

  route.resources("projects", (route) => {
    route.resources("tasks", (route) => {
      route.get("custom")
    })
  })

  route.resources("tasks", (route) => {
    route.get("users")
    route.get("collection-get", {on: "collection"})
    route.post("collection-post", {on: "collection"})
    route.get("member-get", {on: "member"})
    route.post("member-post", {on: "member"})
  })

  route.get("missing-view")
  route.get("ping")
  route.get("params")
  route.post("upload")
})

export default {routes}
