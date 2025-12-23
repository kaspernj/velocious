import fetch from "node-fetch"

import {describe, expect, it} from "../../../src/testing/test.js"
import Dummy from "../../dummy/index.js"
import Project from "../../dummy/src/models/project.js"

describe("HttpServer - tasks - member and collection", {databaseCleaning: {transaction: false, truncate: true}, focus: true}, async () => {
  it("handles collection get routes", async () => {
    await Dummy.run(async () => {
      const response = await fetch("http://localhost:3006/tasks/collection-get")
      const text = await response.text()

      expect(response.status).toEqual(200)
      expect(response.statusText).toEqual("OK")
      expect(JSON.parse(text)).toEqual({scope: "collection", method: "get"})
    })
  })

  it("handles collection post routes", async () => {
    await Dummy.run(async () => {
      const response = await fetch("http://localhost:3006/tasks/collection-post", {method: "POST"})
      const text = await response.text()

      expect(response.status).toEqual(200)
      expect(response.statusText).toEqual("OK")
      expect(JSON.parse(text)).toEqual({scope: "collection", method: "post"})
    })
  })

  it("handles member get routes", async () => {
    await Dummy.run(async () => {
      const project = await Project.create({name: "Member Get Project"})
      const task = await project.tasks().create({name: "Member Get Task"})
      const response = await fetch(`http://localhost:3006/tasks/${task.id()}/member-get`)
      const text = await response.text()

      expect(response.status).toEqual(200)
      expect(response.statusText).toEqual("OK")
      expect(JSON.parse(text)).toEqual({
        scope: "member",
        method: "get",
        task: {id: task.id(), name: "Member Get Task"}
      })
    })
  })

  it("handles member post routes", async () => {
    await Dummy.run(async () => {
      const project = await Project.create({name: "Member Post Project"})
      const task = await project.tasks().create({name: "Member Post Task"})
      const response = await fetch(`http://localhost:3006/tasks/${task.id()}/member-post`, {method: "POST"})
      const text = await response.text()

      expect(response.status).toEqual(200)
      expect(response.statusText).toEqual("OK")
      expect(JSON.parse(text)).toEqual({
        scope: "member",
        method: "post",
        task: {id: task.id(), name: "Member Post Task"}
      })
    })
  })
})
