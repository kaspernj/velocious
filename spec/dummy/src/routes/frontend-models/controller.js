import Controller from "../../../../../src/controller.js"

/** Dummy frontend-models controller for resolver auto-route specs. */
export default class FrontendModelsController extends Controller {
  /** @returns {Promise<void>} - Resolves when complete. */
  async frontendIndex() {
    await this.render({json: {source: "frontend-autoroute", status: "success"}})
  }
}
