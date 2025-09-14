import AppRoutes from "../../src/routes/app-routes.js"
import Client from "../../src/http-server/client/index.js"
import {digg} from "diggerize"
import dummyConfiguration from "../dummy/src/config/configuration.js"

describe("http server - client", {databaseCleaning: {transaction: false, truncate: true}}, () => {
  it("spawns a request for each that it is fed", async () => {
    await dummyConfiguration.initialize()

    const routes = await AppRoutes.getRoutes(dummyConfiguration)

    dummyConfiguration.setRoutes(routes)

    const client = new Client({
      clientCount: 0,
      configuration: dummyConfiguration
    })

    const strings = [
      "GET /tasks",
      " HTTP/1.1",
      "\r\n",
      "Host: www.example.com\r\n",
      "\r\n"
    ]

    for (const string of strings) {
      client.onWrite(Buffer.from(string, "utf-8"))
    }

    const currentRequest = digg(client, "currentRequest")

    expect(currentRequest.httpMethod()).toBe("GET")
    expect(currentRequest.host()).toBe("www.example.com")
    expect(currentRequest.path()).toBe("/tasks")
  })
})
