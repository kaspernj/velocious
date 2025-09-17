import fetch from "node-fetch"
import Dummy from "../dummy/index.js"
import net from "net"
import {wait} from "awaitery"

function httpOneZeroRequest(path) {
  return new Promise((resolve, reject) => {
    let response = ""
    let headers = {}
    let body = ""

    const client = net.createConnection(3006, "127.0.0.1", () => {
      // Send a raw HTTP/1.0 request
      client.write(
        `GET ${path} HTTP/1.0\r\n` +
        'Host: example.com\r\n' +
        '\r\n'
      )
    })

    // Print the server’s response
    client.on("data", (data) => {
      response += data.toString()
    })

    client.on("error", (error) => {
      reject(error)
    })

    client.on("end", () => {
      console.log("Disconnected from server", {response})

      const lines = response.split("\r\n")
      const statusLine = lines.shift()
      let status = "headers"

      for (const line of lines) {
        if (status === "headers" && line === "") {
          status = "body"
        } else if (status === "body") {
          body += line
        } else {
          const headerMatch = line.match(/^(.+?):\s*(.+)$/)

          if (!headerMatch) throw new Error(`Couldn't match: ${line}`)

          headers[headerMatch[1]] = headerMatch[2]
        }
      }

      resolve({
        statusLine,
        body,
        headers
      })
    })
  })
}

describe("HttpServer - get", {databaseCleaning: {transaction: false, truncate: true}}, () => {
  it("handles get requests", async () => {
    await Dummy.run(async () => {
      for (let i = 0; i <= 5; i++) {
        const response = await fetch("http://localhost:3006/tasks")
        const text = await response.text()

        expect(response.status).toEqual(200)
        expect(response.statusText).toEqual("OK")
        expect(text).toEqual("1, 2, 3, 4, 5\n")
      }
    })
  })

  it("returns a 404 error when a collection action isnt found", async () => {
    await Dummy.run(async () => {
      for (let i = 0; i <= 5; i++) {
        const response = await fetch("http://localhost:3006/tasks/doesnt-exist")
        const text = await response.text()

        expect(response.status).toEqual(404)
        expect(response.statusText).toEqual("Not Found")
        expect(text).toEqual("Path not found: /tasks/doesnt-exist\n")
      }
    })
  })

  it("supports HTTP 1.0 close connection", async () => {
    await Dummy.run(async () => {
      await wait(500)

      const {body, headers} = await httpOneZeroRequest("/ping")
      const json = JSON.parse(body)

      expect(json).toEqual({message: "Pong"})

      console.log({headers})

      expect(headers.Connection).toEqual("Close")

      /*
      const response = await fetch("http://localhost:3006/ping")
      const text = await response.json()

      expect(text).toEqual({message: "Pong"})
      */
    })
  })
})
