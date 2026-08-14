// @ts-check

import BackgroundJobsAdapter from "../../src/background-jobs/adapter.js"

export default class BackgroundJobsTestAdapter extends BackgroundJobsAdapter {
  /**
   * @param {{ready?: () => Promise<void>}} [args] - Adapter hooks.
   */
  constructor({ready} = {}) {
    super()
    this.calls = []
    this.closeCount = 0
    this.readyCount = 0
    this.healthResult = {ready: true}
    this.ready = ready
  }

  // Framework callback invoked through the BackgroundJobsAdapter contract.
  // fallow-ignore-next-line unused-class-member
  async ensureReady() {
    this.calls.push({method: "ensureReady"})
    this.readyCount++
    await this.ready?.()
  }

  // Framework callback invoked through the BackgroundJobsAdapter contract.
  // fallow-ignore-next-line unused-class-member
  async close() {
    this.calls.push({method: "close"})
    this.closeCount++
  }

  // Framework callback invoked through the BackgroundJobsAdapter contract.
  // fallow-ignore-next-line unused-class-member
  async health() {
    this.calls.push({method: "health"})
    return this.healthResult
  }

  // Framework callback invoked through the BackgroundJobsAdapter contract.
  // fallow-ignore-next-line unused-class-member
  async enqueue(args) {
    this.calls.push({args, method: "enqueue"})
    return "adapter-job-id"
  }
}
