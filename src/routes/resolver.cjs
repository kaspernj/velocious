module.exports = class VelociousRoutesResolver {
  constructor({request, response}) {
    this.request = request
    this.response = response
  }

  resolve() {
    throw new Error("stub")
  }
}
