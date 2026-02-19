import Controller from "../../../../../src/controller.js"

/** Dummy backend endpoint used by browser frontend-model integration specs. */
export default class FrontendModelSystemTestsController extends Controller {
  /**
   * @returns {Record<string, any>} - Project-like payload with nested task/comment preload data.
   */
  preloadModelPayload() {
    return {
      email: "project@example.com",
      id: "project-1",
      __preloadedRelationships: {
        tasks: [
          {
            id: "task-1",
            name: "Task one",
            __preloadedRelationships: {
              comments: [
                {
                  body: "First",
                  id: "comment-1"
                }
              ]
            }
          }
        ]
      }
    }
  }

  /** @returns {Promise<void>} - Resolves when complete. */
  async frontendIndex() {
    const preload = this.params().preload
    const preloadingTasks = preload && typeof preload === "object" && "tasks" in preload

    await this.render({
      json: {
        models: [
          preloadingTasks ? this.preloadModelPayload() : {
            createdAt: "2026-02-18T08:00:00.000Z",
            email: "jane@example.com",
            id: "1",
            metadata: {
              region: "eu",
              tier: "pro"
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
