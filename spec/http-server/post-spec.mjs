import fetch from "node-fetch"
import Dummy from "../dummy/index.mjs"
import querystring from "querystring"
import Task from "../dummy/src/models/task.mjs"

describe("HttpServer", () => {
  it("handles post requests", async () => {
    await Dummy.run(async () => {
      const postData = querystring.stringify({"task[name]": "Test create task"})
      const response = await fetch(
        "http://localhost:3006/tasks",
        {
          body: postData,
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Content-Length": Buffer.byteLength(postData)
          },
          method: "POST"
        }
      )
      const text = await response.text()
      const createdTask = await Task.last()

      expect(text).toEqual('{"status":"success"}')
      expect(createdTask.readAttribute("name")).toEqual("Test create task")
    })
  })

  it("handles post json requests", async () => {
    await Dummy.run(async () => {
      const postData = JSON.stringify({task: {name: "Test create task"}})
      const response = await fetch(
        "http://localhost:3006/tasks",
        {
          body: postData,
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(postData)
          },
          method: "POST"
        }
      )
      const text = await response.text()
      const createdTask = await Task.last()

      expect(text).toEqual('{"status":"success"}')
      expect(createdTask.readAttribute("name")).toEqual("Test create task")
    })
  })

  it("handles post form-data requests", async () => {
    await Dummy.run(async () => {
      const body = new FormData()

      body.append("task[name]", "Test create task")
      body.append("task[description]", "This is a task")

      const response = await fetch(
        "http://localhost:3006/tasks",
        {
          body,
          method: "POST"
        }
      )
      const text = await response.text()
      const createdTask = await Task.last()

      expect(text).toEqual('{"status":"success"}')
      expect(createdTask.readAttribute("name")).toEqual("Test create task")
    })
  })
})
