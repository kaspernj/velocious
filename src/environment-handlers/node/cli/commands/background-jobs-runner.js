import BaseCommand from "../../../../cli/base-command.js"
import runJobPayload from "../../../../background-jobs/job-runner.js"

export default class BackgroundJobsRunnerCommand extends BaseCommand {
  async execute() {
    const payload = process.env.VELOCIOUS_JOB_PAYLOAD

    if (!payload) throw new Error("Missing VELOCIOUS_JOB_PAYLOAD")

    const decoded = Buffer.from(payload, "base64").toString("utf8")
    const jobPayload = JSON.parse(decoded)

    await runJobPayload(jobPayload)
  }
}
