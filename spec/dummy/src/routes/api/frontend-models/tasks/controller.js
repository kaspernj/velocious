import FrontendModelController from "../../../../../../../src/frontend-model-controller.js"

/** Dummy frontend-model controller for Task resource command endpoints. */
export default class ApiFrontendModelsTasksController extends FrontendModelController {
  /** @returns {Promise<void>} */
  async list() {
    await this.frontendIndex()
  }

  /** @returns {Promise<void>} */
  async find() {
    await this.frontendFind()
  }

  /** @returns {Promise<void>} */
  async update() {
    await this.frontendUpdate()
  }

  /** @returns {Promise<void>} */
  async destroy() {
    await this.frontendDestroy()
  }
}
