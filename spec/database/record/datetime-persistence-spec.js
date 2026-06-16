// @ts-check

import Project from "../../dummy/src/models/project.js"
import Task from "../../dummy/src/models/task.js"
import process from "node:process"
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

  /**
   * Runs a callback with the Node process timezone temporarily changed.
   * @param {string} timezone - IANA timezone name.
   * @param {() => Promise<void>} callback - Callback to run.
   * @returns {Promise<void>} - Resolves when the callback has completed.
   */
  async function runWithProcessTimezone(timezone, callback) {
    const previousTimezone = process.env.TZ

    process.env.TZ = timezone

    try {
      await callback()
    } finally {
      if (previousTimezone === undefined) {
        delete process.env.TZ
      } else {
        process.env.TZ = previousTimezone
      }
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

  it("treats timezone-less datetime strings as UTC", async () => {
    const task = new Task({name: "UTC string task", createdAt: "2025-06-12 12:34:56.789"})
    const createdAt = task.createdAt()

    expect(createdAt).toBeInstanceOf(Date)
    expectTimestampMatches(createdAt, new Date("2025-06-12T12:34:56.789Z"))
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
