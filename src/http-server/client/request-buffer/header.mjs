export default class Header {
  constructor(name, value) {
    this.formattedName = name.toLowerCase().trim()
    this.name = name
    this.value = value
  }
}
