// @ts-check

import {describe, expect, it} from "../../../src/testing/test.js"
import DatabaseRecord from "../../../src/database/record/index.js"

describe("Record attachment definitions", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("keeps synchronized asset policy on the attachment declaration", () => {
    class User extends DatabaseRecord {}

    User.hasOneAttachment("profilePicture", {
      sync: {
        fetch: "eager",
        offlineRequirement: "optional",
        retention: "evictable"
      }
    })

    expect(User.getAttachmentByName("profilePicture")).toEqual({
      driver: undefined,
      sync: {
        fetch: "eager",
        offlineRequirement: "optional",
        retention: "evictable"
      },
      type: "hasOne"
    })
  })

  it("rejects an evictable attachment that is required offline", async () => {
    class Document extends DatabaseRecord {}

    await expect(() => Document.hasOneAttachment("source", {
      sync: {
        fetch: "eager",
        offlineRequirement: "required",
        retention: "evictable"
      }
    })).toThrow(/required.*durable/i)
  })
})
