// @ts-check

import FrontendModelController from "../src/frontend-model-controller.js"
import {describe, expect, it} from "../src/testing/test.js"

describe("FrontendModelController", () => {
  it("honors configured frontend-model primary key overrides", () => {
    const controller = /** @type {FrontendModelController & {
     *   frontendModelResourceConfigurationForModelClass: (modelClass: typeof import("../src/database/record/index.js").default) => {resourceConfiguration: {primaryKey?: string}} | null
     * }} */ ({
      frontendModelResourceConfigurationForModelClass(modelClass) {
        void modelClass

        return {resourceConfiguration: {primaryKey: "reference"}}
      }
    })
    const modelClass = /** @type {typeof import("../src/database/record/index.js").default} */ ({
      primaryKey() {
        return "id"
      }
    })

    expect(FrontendModelController.prototype.frontendModelPrimaryKeyForModelClass.call(controller, modelClass)).toEqual("reference")
  })
})
