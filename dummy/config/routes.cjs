const VelociousRoutes = require("../../src/routes.cjs")
const routes = new VelociousRoutes()

routes.get("test", {to: "test-controller#show"})

module.exports = routes
