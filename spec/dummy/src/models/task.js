import DatabaseRecord from "../../../../src/database/record/index.js"

class Task extends DatabaseRecord {
}

Task.belongsTo("project")

export default Task
