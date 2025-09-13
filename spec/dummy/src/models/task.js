import Record from "../../../../src/database/record/index.js"

class Task extends Record {
}

Task.belongsTo("project")
Task.validates("name", {presence: true, uniqueness: true})

export default Task
