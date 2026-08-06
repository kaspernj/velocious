// @ts-check

import fetch from "node-fetch"

import {describe, expect, it} from "../../src/testing/test.js"
import Dummy from "../dummy/index.js"
import {RAMPWAY_DEPLOYMENT_TOKEN} from "../dummy/src/config/rampway-deployment-config.js"

const API_BASE = "http://localhost:3006/rampway/deployments"

describe("plugins - Rampway Velocious integration", {
  databaseCleaning: {transaction: false, truncate: true}
}, () => {
  it("rejects unauthenticated deployment requests with Rampway JSON", async () => {
    await Dummy.run(async () => {
      const response = await fetch(`${API_BASE}/runs`, {method: "POST"})

      expect(response.status).toEqual(401)
      expect(await response.json()).toEqual({error: "unauthorized"})
    })
  })

  it("validates authenticated requests before launching deployment", async () => {
    await Dummy.run(async () => {
      const response = await fetch(`${API_BASE}/runs`, {
        body: JSON.stringify({}),
        headers: {
          Authorization: `Bearer ${RAMPWAY_DEPLOYMENT_TOKEN}`,
          "Content-Type": "application/json"
        },
        method: "POST"
      })

      expect(response.status).toEqual(422)
      expect(await response.json()).toEqual({
        error: "invalid_params",
        fields: ["revision", "idempotencyKey"]
      })
    })
  })

  it("reads a missing run through Rampway's durable run store", async () => {
    await Dummy.run(async () => {
      const response = await fetch(`${API_BASE}/runs/nonexistent`, {
        headers: {Authorization: `Bearer ${RAMPWAY_DEPLOYMENT_TOKEN}`}
      })

      expect(response.status).toEqual(404)
      expect(await response.json()).toEqual({error: "not_found"})
    })
  })
})
