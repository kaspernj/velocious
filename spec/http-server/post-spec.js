import fetch from "node-fetch"
import querystring from "querystring"

import Dummy from "../dummy/index.js"
import Project from "../dummy/src/models/project.js"

describe("HttpServer", () => {
  it("handles post requests", async () => {
    await Dummy.run(async () => {
      const postData = querystring.stringify({"project[name]": "Test create project"})
      const response = await fetch(
        "http://localhost:3006/projects",
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
      const createdProject = await Project.preload({translations: true}).last()

      expect(text).toEqual('{"status":"success"}')
      expect(createdProject.name()).toEqual("Test create project")
    })
  })

  it("handles post json requests", async () => {
    await Dummy.run(async () => {
      const postData = JSON.stringify({project: {name: "Test create project"}})
      const response = await fetch(
        "http://localhost:3006/projects",
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
      const createdProject = await Project.preload({translations: true}).last()

      expect(text).toEqual('{"status":"success"}')
      expect(createdProject.name()).toEqual("Test create project")
    })
  })

  it("handles post form-data requests", async () => {
    await Dummy.run(async () => {
      const body = new FormData()

      body.append("project[name]", "Test create project")

      const response = await fetch(
        "http://localhost:3006/projects",
        {
          body,
          method: "POST"
        }
      )
      const text = await response.text()
      const createdProject = await Project.preload({translations: true}).last()

      expect(text).toEqual('{"status":"success"}')
      expect(createdProject.name()).toEqual("Test create project")
    })
  })
})
