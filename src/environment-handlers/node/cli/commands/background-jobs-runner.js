import BaseCommand from "../../../../cli/base-command.js"
import runJobPayload from "../../../../background-jobs/job-runner.js"

export default class BackgroundJobsRunnerCommand extends BaseCommand {
  async execute() {
    const payload = process.env.VELOCIOUS_JOB_PAYLOAD

    if (!payload) throw new Error("Missing VELOCIOUS_JOB_PAYLOAD")

    // A graceful worker shutdown (e.g. a deploy draining the old release)
    // SIGTERMs this spawned runner to reap it. Exit promptly so it does not
    // linger as an orphan running against deleted release code; the OS releases
    // the runner's DB/beacon sockets on exit and main's orphan sweep reclaims
    // the in-flight job.
    for (const signal of ["SIGTERM", "SIGINT"]) {
      process.once(signal, () => process.exit(0))
    }

    const decoded = Buffer.from(payload, "base64").toString("utf8")
    const jobPayload = JSON.parse(decoded)

    await runJobPayload(jobPayload, {closeConnections: false})
    process.exit(0)
  }
}
