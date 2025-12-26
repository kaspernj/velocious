// @ts-check

export default class Header {
  /**
   * @param {string} name - Name.
   * @param {string | number} value - Value to use.
   */
  constructor(name, value) {
    this.name = name
    this.value = value
  }

  getName() { return this.name }
  getValue() { return this.value }
  toString() { return `${this.getName()}: ${this.getValue()}` }
}
