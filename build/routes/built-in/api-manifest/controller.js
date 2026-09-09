import Controller from "../../../controller.js"

export default class BuiltInApiManifestController extends Controller {
  /**
   * Runs show.
   * @returns {Promise<void>} - Resolves when the manifest has been rendered.
   */
  async show() {
    const manifest = await this.getConfiguration().getApiManifest()

    this._response.setHeader("Content-Type", "application/json; charset=UTF-8")
    this._response.setBody(`${JSON.stringify(manifest, null, 2)}\n`)
  }
}
