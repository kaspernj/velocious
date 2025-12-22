import {describe, expect, it, fit} from "../../../../src/testing/test.js"
import fetch from "node-fetch"
import Dummy from "../../../dummy/index.js"
import Project from "../../../dummy/src/models/project.js"

describe("HttpServer - projects - tasks - custom", {databaseCleaning: {transaction: false, truncate: true}}, async () => {
  fit("handles complicated route paths with nested resources and custom routes", async () => {
    await Dummy.run(async () => {
      const project = await Project.create({name: "Test project"})
      const task = await project.tasks().create({name: "Test task"})

      for (let i = 0; i <= 5; i++) {
        const response = await fetch(`http://localhost:3006/projects/${project.id()}/tasks/${task.id()}/custom`)
        const text = await response.text()

        console.log({text})

        expect(response.status).toEqual(200)
        expect(response.statusText).toEqual("OK")
        expect(text).toEqual("1, 2, 3, 4, 5\n")
      }
    })
  })
})
