// @ts-check

import DevelopmentReloader from "../../src/http-server/development-reloader.js"
import {describe, expect, it} from "../../src/testing/test.js"
import path from "path"

describe("HttpServer development reloader", () => {
  it("watches nested source directories and reloads changed JS files", async () => {
    const callbacks = new Map()
    const closed = new Set()
    const reloads = []

    const reloader = new DevelopmentReloader({
      configuration: {
        getBackendProjects: () => [],
        getDirectory: () => "/app"
      },
      debounceMs: 0,
      onReload: async ({changedPath}) => {
        reloads.push(changedPath)
      },
      readdir: async (directoryPath) => {
        if (directoryPath === path.resolve("/app/src")) {
          return [
            {isDirectory: () => true, name: "models"},
            {isDirectory: () => false, name: "ignored.txt"}
          ]
        }

        if (directoryPath === path.resolve("/app/src/models")) {
          return []
        }

        return []
      },
      stat: async (changedPath) => {
        if (changedPath === path.resolve("/app/src/tasks")) {
          return {isDirectory: () => true}
        }

        return {isDirectory: () => false}
      },
      watchFactory: (directoryPath, callback) => {
        callbacks.set(path.resolve(directoryPath), callback)

        return {
          close: () => {
            closed.add(path.resolve(directoryPath))
          },
          on: () => {}
        }
      }
    })

    await reloader.start()

    expect(Array.from(callbacks.keys()).sort()).toEqual([
      path.resolve("/app/src"),
      path.resolve("/app/src/models")
    ])

    const rootCallback = callbacks.get(path.resolve("/app/src"))

    if (!rootCallback) throw new Error("Expected root callback")

    rootCallback("change", "models/user.js")

    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(reloads).toEqual([path.resolve("/app/src/models/user.js")])

    rootCallback("rename", "tasks")

    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(Array.from(callbacks.keys()).sort()).toEqual([
      path.resolve("/app/src"),
      path.resolve("/app/src/models"),
      path.resolve("/app/src/tasks")
    ])

    await reloader.stop()

    expect(closed).toEqual(new Set([
      path.resolve("/app/src"),
      path.resolve("/app/src/models"),
      path.resolve("/app/src/tasks")
    ]))
  })
})
