import DatabaseRecord from "../../../../src/database/record/index.js"

class Task extends DatabaseRecord {
}

Task.belongsTo("project")
Task.validates("name", {presence: true, uniqueness: true})

export default Task
