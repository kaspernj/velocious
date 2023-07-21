import fetch from "node-fetch"
import Dummy from "../dummy/index.mjs"
import querystring from "querystring"
import Task from "../dummy/src/models/task.mjs"

describe("HttpServer", () => {
  fit("handles post requests", async () => {
    await Dummy.run(async () => {
      const postData = querystring.stringify({
        task: {
          name: "Test create task"
        }
      })
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

      expect(text).toEqual("1, 2, 3, 4, 5\n")
      expect(createdTask.readAttribute("name")).toEqual("Test create task")
    })
  })
})
