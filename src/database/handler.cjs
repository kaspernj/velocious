module.exports = class VelociousDatabaseHandler {
  constructor() {
    console.log("stub")
  }

  clone() {
    const newHandler = new VelociousDatabaseHandler()

    return newHandler
  }
}
