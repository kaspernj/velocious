import Routes from "../../../../src/routes/index.js"

const routes = new Routes()

routes.draw((route) => {
  route.namespace("api", (route) => {
    route.post("broadcast-event")
    route.post("metadata")
    route.post("version")

    route.namespace("frontend-models", (route) => {
      route.namespace("tasks", (route) => {
        route.post("attach")
        route.post("download")
        route.post("url")
        route.post("list")
        route.post("find")
        route.post("update")
        route.post("destroy")
      })
    })
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
  route.namespace("cookies", (route) => {
    route.get("set")
    route.get("set-encrypted")
    route.get("read")
  })
  route.get("ping")
  route.get("ping-with-status")
  route.post("current-user/update")
  route.post("current-user/update-password")
  route.get("current-user/update/details")
  route.get("params")
  route.get("slow")
  route.post("upload")
})

export default {routes}
