const Routes = require("./routes/index.cjs")
const routes = new Routes()

routes.draw((route) => {
  route.resources("tasks", (route) => {
    route.get("users")
  })
})

module.exports = {routes}
