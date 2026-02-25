import Controller from "../../../../../src/controller.js"

/** Dummy backend endpoint used by browser frontend-model integration specs. */
export default class FrontendModelSystemTestsController extends Controller {
  /**
   * @param {unknown} actualValue - Actual value.
   * @param {unknown} expectedValue - Expected value.
   * @returns {boolean} - Whether values match with frontend-model semantics.
   */
  valuesMatch(actualValue, expectedValue) {
    if (expectedValue === null) {
      return actualValue === null
    }

    if (Array.isArray(expectedValue)) {
      if (!Array.isArray(actualValue)) {
        return false
      }

      if (actualValue.length !== expectedValue.length) {
        return false
      }

      for (let index = 0; index < expectedValue.length; index += 1) {
        if (!this.valuesMatch(actualValue[index], expectedValue[index])) {
          return false
        }
      }

      return true
    }

    if (expectedValue && typeof expectedValue === "object") {
      if (!actualValue || typeof actualValue !== "object" || Array.isArray(actualValue)) {
        return false
      }

      const actualObject = /** @type {Record<string, unknown>} */ (actualValue)
      const expectedObject = /** @type {Record<string, unknown>} */ (expectedValue)
      const actualKeys = Object.keys(actualObject)
      const expectedKeys = Object.keys(expectedObject)

      if (actualKeys.length !== expectedKeys.length) {
        return false
      }

      for (const key of expectedKeys) {
        if (!Object.prototype.hasOwnProperty.call(actualObject, key)) {
          return false
        }

        if (!this.valuesMatch(actualObject[key], expectedObject[key])) {
          return false
        }
      }

      return true
    }

    if (actualValue === expectedValue) {
      return true
    }

    if (typeof actualValue === "number" && typeof expectedValue === "string" && /^-?\d+(?:\.\d+)?$/.test(expectedValue)) {
      return Number(expectedValue) === actualValue
    }

    if (typeof actualValue === "string" && typeof expectedValue === "number" && /^-?\d+(?:\.\d+)?$/.test(actualValue)) {
      return Number(actualValue) === expectedValue
    }

    return false
  }

  /**
   * @param {Record<string, any>} model - Model payload.
   * @param {Record<string, any> | undefined} where - Where payload.
   * @returns {boolean} - Whether model matches where conditions.
   */
  matchesWhere(model, where) {
    if (!where || typeof where !== "object") return true

    for (const [attributeName, expectedValue] of Object.entries(where)) {
      const actualValue = model[attributeName]
      if (!this.valuesMatch(actualValue, expectedValue)) {
        return false
      }
    }

    return true
  }

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
    const filtered = {}

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
    const where = /** @type {Record<string, any> | undefined} */ (this.params().where)
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
    const models = [
      preloadingTasks ? selectedPreloadProject : firstDefaultModel,
      secondDefaultModel
    ].filter((model) => this.matchesWhere(model, where))

    await this.render({
      json: {
        models,
        status: "success"
      }
    })
  }
}
