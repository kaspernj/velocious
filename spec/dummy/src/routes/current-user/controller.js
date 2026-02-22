import Controller from "../../../../../src/controller.js"

/** Dummy current-user controller for route action/controller path specs. */
export default class CurrentUserController extends Controller {
  /** @returns {Promise<void>} - Resolves when complete. */
  async update() {
    await this.render({
      json: {
        message: "Current user updated"
      }
    })
  }

  /** @returns {Promise<void>} - Resolves when complete. */
  async updatePassword() {
    await this.render({
      json: {
        message: "Current user password updated"
      }
    })
  }
}
