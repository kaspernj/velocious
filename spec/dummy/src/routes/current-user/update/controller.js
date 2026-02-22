import Controller from "../../../../../../src/controller.js"

/** Dummy current-user/update controller for nested action route specs. */
export default class CurrentUserUpdateController extends Controller {
  /** @returns {Promise<void>} - Resolves when complete. */
  async details() {
    await this.render({
      json: {
        message: "Current user update details"
      }
    })
  }
}
