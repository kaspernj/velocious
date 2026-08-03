// @ts-check

import fetch from "node-fetch"

const API_BASE = "http://localhost:3006/velocious/deployments"

/**
 * POSTs a deployment-run creation request to the dummy-mounted deployment API.
 * @param {object} args - Options.
 * @param {Record<string, ?>} args.payload - JSON body.
 * @param {string} [args.token] - Bearer token; omitted when not given.
 * @returns {Promise<{body: Record<string, ?>, status: number}>} - Parsed response.
 */
export async function postDeploymentRun({payload, token}) {
  const body = JSON.stringify(payload)
  /** @type {Record<string, string>} */
  const headers = {"Content-Type": "application/json", "Content-Length": Buffer.byteLength(body).toString()}

  if (token) headers.Authorization = `Bearer ${token}`

  const response = await fetch(`${API_BASE}/runs`, {body, headers, method: "POST"})

  return {body: await response.json(), status: response.status}
}

/**
 * GETs a deployment run from the dummy-mounted deployment API.
 * @param {object} args - Options.
 * @param {string} args.id - Run id.
 * @param {string} [args.token] - Bearer token; omitted when not given.
 * @returns {Promise<{body: Record<string, ?>, status: number}>} - Parsed response.
 */
export async function getDeploymentRun({id, token}) {
  /** @type {Record<string, string>} */
  const headers = {}

  if (token) headers.Authorization = `Bearer ${token}`

  const response = await fetch(`${API_BASE}/runs/${id}`, {headers})

  return {body: await response.json(), status: response.status}
}
