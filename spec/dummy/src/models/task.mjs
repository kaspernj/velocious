import DatabaseRecord from "../../../../src/database/record/index.mjs"

class Task extends DatabaseRecord {
}

Task.belongsTo("project")

export default Task
