// @ts-check

import fs from "node:fs/promises"
import VelociousJob from "../../../../src/background-jobs/job.js"
import Project from "../models/project.js"

export default class SharedTransactionTestJob extends VelociousJob {
  static databaseIdentifiers = ["default"]

  /** @param {string} parentMarker - Parent marker. @param {string} childMarker - Child marker. @param {string} outputPath - Result path. */
  async perform(parentMarker, childMarker, outputPath) {
    const parentRows = await Project.where({creatingUserReference: parentMarker}).toArray()
    await Project.create({creatingUserReference: childMarker})
    const childRows = await Project.where({creatingUserReference: childMarker}).toArray()
    await fs.writeFile(outputPath, JSON.stringify({childCount: childRows.length, parentCount: parentRows.length, pid: process.pid}))
  }
}
