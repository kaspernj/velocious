// @ts-check

import {describe, expect, it} from "../../../src/testing/test.js"

describe("Expect#toMatchObject", () => {
  it("matches nested object subsets", () => {
    const actual = {a: 1, b: {c: 2, d: 3}, extra: true}

    expect(actual).toMatchObject({b: {c: 2}})
  })

  it("matches array subsets by index", () => {
    const actual = {items: [{id: 1, name: "a"}, {id: 2, name: "b"}]}

    expect(actual).toMatchObject({items: [{id: 1}]})
  })

  it("fails when the object does not match", async () => {
    await expect(() => {
      expect({a: 1, b: {c: 2}}).toMatchObject({b: {c: 3}})
    }).toThrowError('Expected {"a":1,"b":{"c":2}} to match {"b":{"c":3}} (diff: {"b.c":[3,2]})')
  })

  it("compares non-plain values by value", async () => {
    const actual = {createdAt: new Date("2024-01-01T00:00:00.000Z")}

    expect(actual).toMatchObject({createdAt: new Date("2024-01-01T00:00:00.000Z")})

    await expect(() => {
      expect(actual).toMatchObject({createdAt: new Date("2024-01-02T00:00:00.000Z")})
    }).toThrowError('Expected {"createdAt":"Date"} to match {"createdAt":"Date"} (diff: {"createdAt":["Date","Date"]})')
  })

  it("fails when the matcher argument is not an object", async () => {
    await expect(() => {
      expect({a: 1}).toMatchObject(5)
    }).toThrowError("Expected object but got number")
  })

  it("supports negated matches", async () => {
    await expect(() => {
      expect({a: 1, b: 2}).not.toMatchObject({a: 1})
    }).toThrowError('Expected {"a":1,"b":2} not to match {"a":1}')
  })
})
