const Client = require("../../src/http-server/client/index.cjs")
const Configuration = require("../../src/configuration.cjs")
const {digg} = require("@kaspernj/object-digger")
const path = require("path")

describe("http server - client", () => {
  it("spawns a request for each that it is fed", () => {
    const dummyDirectory = path.join(__dirname, "../dummy")
    const configuration = new Configuration({
      directory: dummyDirectory
    })
    const client = new Client({
      clientCount: 0,
      configuration
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
