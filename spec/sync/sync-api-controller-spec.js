import {describe, expect, it} from "../../src/testing/test.js"
import FrontendModelBaseResource from "../../src/frontend-model-resource/base-resource.js"
import SyncApiController from "../../src/sync/sync-api-controller.js"

class TestSyncModel {}

class TestSyncResource extends FrontendModelBaseResource {
  static ModelClass = TestSyncModel
}

describe("sync api controller", () => {
  it("passes ability context, locals, params, and request into sync resources", () => {
    const request = {id: "request-1"}
    const ability = {
      getContext: () => ({currentDevice: {id: "device-1"}, currentUser: {id: "user-1"}, offlineGrant: {id: "grant-1"}}),
      getLocals: () => ({traceId: "trace-1"})
    }
    const params = {authenticationToken: "token-1"}
    const ControllerClass = SyncApiController.withSyncResourceClass(TestSyncResource)
    const controller = Object.assign(Object.create(ControllerClass.prototype), {
      currentAbility: () => ability,
      params: () => params,
      request: () => request
    })

    const resource = controller.syncResource(params)

    expect(resource.currentUser()).toEqual({id: "user-1"})
    expect(resource.currentDevice()).toEqual({id: "device-1"})
    expect(resource.offlineGrant()).toEqual({id: "grant-1"})
    expect(resource.request()).toEqual(request)
    expect(resource.params()).toEqual(params)
    expect(resource.getLocals()).toEqual({traceId: "trace-1"})
  })
})
