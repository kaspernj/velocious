import {digg} from "diggerize"
import fetch from "node-fetch"
import querystring from "querystring"
import wait from "awaitery/src/wait.js"

import Dummy from "../dummy/index.js"
import Project from "../dummy/src/models/project.js"

describe("HttpServer - post", {databaseCleaning: {transaction: false, truncate: true}}, () => {
  it("handles post requests", async () => {
    await Dummy.run(async () => {
      for (let i = 0; i <= 5; i++) {
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
        const data = await response.json()
        const projectID = digg(data, "project", "id")

        await wait(100) // Wait a bit to ensure the database connections are in sync

        const createdProject = await Project.preload({translations: true}).find(projectID)

        expect(createdProject.name()).toEqual("Test create project")
      }
    })
  })

  it("handles post json requests", async () => {
    await Dummy.run(async () => {
      for (let i = 0; i <= 5; i++) {
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
        const data = await response.json()

        expect(data.status).toEqual("success")

        await wait(100) // Wait a bit to ensure the database connections are in sync

        const createdProject = await Project.preload({translations: true}).last()

        expect(createdProject.name()).toEqual("Test create project")
      }
    })
  })

  it("handles post form-data requests", async () => {
    await Dummy.run(async () => {
      for (let i = 0; i <= 5; i++) {
        const body = new FormData()

        body.append("project[creating_user_reference]", 150123)
        body.append("project[name]", "Test create project")

        const response = await fetch(
          "http://localhost:3006/projects",
          {
            body,
            method: "POST"
          }
        )
        const data = await response.json()

        expect(data.status).toEqual("success")

        await wait(100) // Wait a bit to ensure the database connections are in sync

        const createdProject = await Project.preload({translations: true}).last()

        expect(createdProject.creatingUserReference()).toEqual("150123")
        expect(createdProject.name()).toEqual("Test create project")
      }
    })
  })
})
