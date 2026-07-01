import Migration from "../../../../../src/database/migration/index.js"

export default class CreateJoblerJobs extends Migration {
  async change() {
    await this.createTable("jobler_jobs", {id: {type: "bigint"}}, (t) => {
      t.string("name")
      t.string("status")
      t.timestamps()
    })
  }
}
