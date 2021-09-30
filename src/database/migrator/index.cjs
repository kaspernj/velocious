module.exports = class VelociousDatabaseMigrator {
  constructor({path}) {
    if (!path) throw new Error("No 'path' given")

    this.path = path
  }

  migrateUp() {
    throw new Error("stub")
  }

  migrateDown() {
    throw new Error("stub")
  }
}
