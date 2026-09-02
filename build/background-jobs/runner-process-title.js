// @ts-check

/** Sets the idle base process title shared by child runner entrypoints. */
export default function setRunnerProcessTitle() {
  process.title = "velocious background-jobs-runner"
}
