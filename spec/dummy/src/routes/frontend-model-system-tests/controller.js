import Controller from "../../../../../src/controller.js"

/** Dummy backend endpoint used by browser frontend-model integration specs. */
export default class FrontendModelSystemTestsController extends Controller {
  /**
   * @param {Record<string, any>} attributes - Model attributes.
   * @param {string[]} modelNames - Candidate model class names.
   * @param {Record<string, any> | undefined} select - Select payload.
   * @returns {Record<string, any>} - Attributes filtered by select payload.
   */
  applySelect(attributes, modelNames, select) {
    if (!select || typeof select !== "object") return attributes

    /** @type {string[] | null} */
    let selectedAttributes = null

    for (const modelName of modelNames) {
      const selectForModel = select[modelName]

      if (!Array.isArray(selectForModel)) continue
      if (!selectForModel.every((attributeName) => typeof attributeName === "string")) continue

      selectedAttributes = selectForModel
      break
    }

    if (!selectedAttributes) return attributes

    /** @type {Record<string, any>} */
    const filtered = {
      __selectedAttributes: selectedAttributes
    }

    for (const attributeName of selectedAttributes) {
      if (attributeName in attributes) {
        filtered[attributeName] = attributes[attributeName]
      }
    }

    return filtered
  }

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
            updatedAt: "2026-02-20T10:00:00.000Z",
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
    const select = this.params().select
    const preloadingTasks = preload && typeof preload === "object" && "tasks" in preload
    const preloadPayload = this.preloadModelPayload()
    const selectedPreloadTasks = preloadPayload.__preloadedRelationships.tasks.map((task) => this.applySelect(
      task,
      ["HttpPreloadTask", "BrowserPreloadTask"],
      select
    ))
    const selectedPreloadProject = this.applySelect(
      preloadPayload,
      ["HttpPreloadProject", "BrowserPreloadProject"],
      select
    )

    selectedPreloadProject.__preloadedRelationships = {tasks: selectedPreloadTasks}
    const firstDefaultModel = this.applySelect({
      createdAt: "2026-02-18T08:00:00.000Z",
      email: "jane@example.com",
      id: "1",
      metadata: {
        region: "eu",
        tier: "pro"
      },
      tags: ["a"]
    }, ["HttpFrontendModel", "BrowserFrontendModel"], select)
    const secondDefaultModel = this.applySelect({
      createdAt: "2026-02-18T08:00:00.000Z",
      email: "john@example.com",
      id: "2",
      metadata: {
        region: "eu"
      },
      nickName: null,
      tags: ["a", "b"]
    }, ["HttpFrontendModel", "BrowserFrontendModel"], select)

    await this.render({
      json: {
        models: [
          preloadingTasks ? selectedPreloadProject : firstDefaultModel,
          secondDefaultModel
        ],
        status: "success"
      }
    })
  }
}
