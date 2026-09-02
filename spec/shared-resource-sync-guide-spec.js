// @ts-check

import fs from "node:fs"
import path from "node:path"
import {fileURLToPath} from "node:url"

import {describe, expect, it} from "../src/testing/test.js"

/**
 * Builds GitHub-style anchors for Markdown headings.
 * @param {string} markdown - Markdown source.
 * @returns {Set<string>} - Generated heading anchors.
 */
function githubHeadingAnchors(markdown) {
  const headingAnchors = new Set()

  for (const match of markdown.matchAll(/^#{1,6}\s+(.+)$/gm)) {
    const headingAnchorBase = match[1]
      .replace(/`([^`]*)`/g, "$1")
      .replace(/(^|\s)_+(?=\S)/g, "$1")
      .replace(/_+(?=\s|$)/g, "")
      .toLowerCase()
      .replace(/[*~]/g, "")
      .replace(/[^\p{Letter}\p{Mark}\p{Number}\p{Connector_Punctuation}\s-]/gu, "")
      .trim()
      .replace(/\s+/g, "-")
    let headingAnchor = headingAnchorBase
    let suffix = 0

    while (headingAnchors.has(headingAnchor)) {
      suffix += 1
      headingAnchor = `${headingAnchorBase}-${suffix}`
    }

    headingAnchors.add(headingAnchor)
  }

  return headingAnchors
}

describe("Shared-resource sync developer guide", {databaseCleaning: {transaction: false, truncate: false}}, () => {
  it("matches GitHub anchors for duplicate and formatted headings", () => {
    expect([...githubHeadingAnchors("# Foo\n# Foo\n# Foo-1\n# _Emphasized_heading_\n# `peer_received_unapplied`")])
      .toEqual(["foo", "foo-1", "foo-1-1", "emphasized_heading", "peer_received_unapplied"])
  })

  it("links local fragments to generated heading anchors", async () => {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
    const markdown = await fs.promises.readFile(path.join(repoRoot, "docs/shared-resource-sync-guide.md"), "utf8")
    const headingAnchors = githubHeadingAnchors(markdown)

    const unresolvedFragments = []

    for (const match of markdown.matchAll(/\]\(#([^)]+)\)/g)) {
      if (!headingAnchors.has(match[1])) unresolvedFragments.push(match[1])
    }

    expect(unresolvedFragments).toEqual([])
  })
})
