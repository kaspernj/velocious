// @ts-check

import {describe, expect, it} from "../../../src/testing/test.js"

class Person {
  /**
   * @param {string} name
   * @param {number} age
   */
  constructor(name, age) {
    this._name = name
    this._age = age
  }

  name() {
    return this._name
  }

  age() {
    return this._age
  }
}

describe("Expect#toHaveAttributes", () => {
  it("passes when attributes match", () => {
    expect(new Person("Ada", 5)).toHaveAttributes({name: "Ada", age: 5})
  })

  it("fails when attributes differ", async () => {
    await expect(() => {
      expect(new Person("Ada", 5)).toHaveAttributes({age: 6})
    }).toThrowError('Object had differet values: {"age":[6,5]}')
  })
})
