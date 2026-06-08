// @ts-check

import {describe, expect, it} from "../../src/testing/test.js"
import Dummy from "../dummy/index.js"
import UserRecord from "../dummy/src/models/user.js"
import {configureRansackTransport, RansackUser, resetRansackTransport} from "./ransack-test-support.js"

/** @returns {Promise<void>} */
async function seedRansackUsers() {
  await UserRecord.create({
    createdAt: "2026-02-18T08:00:00.000Z",
    email: "jane@example.com",
    encryptedPassword: "password",
    reference: "john-reference"
  })
  await UserRecord.create({
    createdAt: "2026-02-19T08:00:00.000Z",
    email: "john@example.com",
    encryptedPassword: "password",
    reference: "user-2"
  })
}

describe("Frontend model Ransack HTTP integration", {databaseCleaning: {transaction: false, truncate: true}}, () => {
  it("counts and paginates grouped Ransack filters over Node HTTP", async () => {
    await Dummy.run(async () => {
      configureRansackTransport("http://127.0.0.1:3006")

      try {
        await seedRansackUsers()

        const shortcutCount = await RansackUser
          .ransack({email_or_reference_cont: "john"})
          .count()
        const shortcutPage = await RansackUser
          .ransack({email_or_reference_cont: "john"})
          .sort([["email", "asc"]])
          .limit(1)
          .offset(1)
          .toArray()
        const groupedModels = await RansackUser
          .ransack({
            c: [
              {a: ["email"], p: "cont", v: ["jane"]}
            ],
            g: [
              {
                c: [
                  {a: "reference", p: "cont", v: ["user-2"]},
                  {a: "email", p: "cont", v: ["john"]}
                ],
                m: "and"
              }
            ],
            m: "or"
          })
          .sort([["email", "asc"]])
          .toArray()

        expect(shortcutCount).toEqual(2)
        expect(shortcutPage.map((user) => user.email())).toEqual(["john@example.com"])
        expect(groupedModels.map((user) => user.email())).toEqual(["jane@example.com", "john@example.com"])
      } finally {
        resetRansackTransport()
      }
    })
  })
})
