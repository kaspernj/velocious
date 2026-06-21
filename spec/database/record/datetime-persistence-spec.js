// @ts-check

import Project from "../../dummy/src/models/project.js"
import Task from "../../dummy/src/models/task.js"
import runWithProcessTimezone from "../../helpers/process-timezone.js"
import Configuration from "../../../src/configuration.js"

describe("Record - datetime persistence", {tags: ["dummy"]}, () => {
  /**
   * @param {Date | undefined} actual - Actual timestamp read from the database.
   * @param {Date} expected - Expected timestamp.
   * @returns {void} - No return value.
   */
  function expectTimestampMatches(actual, expected) {
    const actualTime = actual?.getTime()
    const expectedTime = expected.getTime()

    if (actualTime === undefined) {
      throw new Error("Expected timestamp to be set")
    }

    if (Task.getDatabaseType() == "mysql") {
      expect(Math.floor(actualTime / 1000)).toEqual(Math.floor(expectedTime / 1000))
    } else if (Task.getDatabaseType() == "mssql") {
      expect(Math.abs(actualTime - expectedTime)).toBeLessThanOrEqual(1)
    } else {
      expect(actualTime).toEqual(expectedTime)
    }
  }

  it("round-trips datetime values across process timezones", async () => {
    const project = await Project.create({name: "Process timezone project"})
    const timestamp = new Date("2025-06-12T12:34:56.789Z")
    /** @type {string | number | undefined} */
    let taskId

    await runWithProcessTimezone("Europe/Berlin", async () => {
      const task = await Task.create({name: "Process timezone task", createdAt: timestamp, project})

      taskId = task.id()
    })

    if (taskId === undefined) throw new Error("Expected task to be created")

    await runWithProcessTimezone("UTC", async () => {
      const reloaded = await Task.find(taskId)

      expectTimestampMatches(reloaded.createdAt(), timestamp)
    })
  })

  it("interprets timezone-less datetime strings in the current request timezone", async () => {
    await Configuration.current().getEnvironmentHandler().runWithTimezone("Europe/Berlin", async () => {
      const winterTask = new Task({name: "Winter local string task", createdAt: "2026-02-18 09:00:00.000"})
      const summerTask = new Task({name: "Summer local string task", createdAt: "2026-06-21 08:00:00.000"})
      const winterCreatedAt = winterTask.createdAt()
      const summerCreatedAt = summerTask.createdAt()

      expect(winterCreatedAt).toBeInstanceOf(Date)
      expect(summerCreatedAt).toBeInstanceOf(Date)
      expectTimestampMatches(winterCreatedAt, new Date("2026-02-18T08:00:00.000Z"))
      expectTimestampMatches(summerCreatedAt, new Date("2026-06-21T06:00:00.000Z"))
    })
  })

  it("does not apply timezoneOffsetMinutes to persisted datetime values", async () => {
    const project = await Project.create({name: "Timezone offset persistence project"})
    const timestamp = new Date("2025-06-12T12:34:56.789Z")
    /** @type {string | number | undefined} */
    let taskId

    await Configuration.current().getEnvironmentHandler().runWithTimezoneOffset(120, async () => {
      const task = await Task.create({name: "Timezone offset persistence task", createdAt: timestamp, project})

      taskId = task.id()
    })

    if (taskId === undefined) throw new Error("Expected task to be created")

    await Configuration.current().getEnvironmentHandler().runWithTimezoneOffset(0, async () => {
      const reloaded = await Task.find(taskId)

      expectTimestampMatches(reloaded.createdAt(), timestamp)
    })
  })
})
