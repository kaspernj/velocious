import Controller from "../../../../../src/controller.js"

/** Dummy backend endpoint used by browser frontend-model integration specs. */
export default class FrontendModelSystemTestsController extends Controller {
  /** @returns {Promise<void>} - Resolves when complete. */
  async frontendIndex() {
    await this.render({
      json: {
        models: [
          {
            createdAt: "2026-02-18T08:00:00.000Z",
            email: "jane@example.com",
            id: "1",
            metadata: {
              region: "us"
            },
            tags: ["a"]
          },
          {
            createdAt: "2026-02-18T08:00:00.000Z",
            email: "john@example.com",
            id: "2",
            metadata: {
              region: "eu"
            },
            nickName: null,
            tags: ["a", "b"]
          }
        ],
        status: "success"
      }
    })
  }
}
