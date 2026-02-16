import Controller from "../../../../../src/controller.js"

/** Dummy hijacked controller for route hook specs. */
export default class HijackedController extends Controller {
  /** @returns {Promise<void>} - Resolves when complete. */
  async index() {
    await this.render({json: {source: "custom-hook", status: "success"}})
  }
}
