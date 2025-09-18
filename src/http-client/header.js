export default class Header {
  constructor(name, value) {
    this.name = name
    this.value = value
  }

  getName() { return this.name }
  getValue() { return this.value }
  toString() { return `${this.getName()}: ${this.getValue()}` }
}
