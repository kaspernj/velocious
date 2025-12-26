// @ts-check

export default class Header {
  /**
   * @param {string} name - Name.
   * @param {string} value - Value to use.
   */
  constructor(name, value) {
    this.formattedName = name.toLowerCase().trim()
    this.name = name
    this.value = value
  }

  getName() { return this.name }
  getFormattedName() { return this.formattedName }
  getValue() { return this.value }
  toString() { return `${this.getName()}: ${this.getValue()}` }
}
