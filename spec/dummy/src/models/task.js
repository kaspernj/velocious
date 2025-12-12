import TaskBase from "../model-bases/task.js"

class Task extends TaskBase {
}

Task.belongsTo("project")
Task.validates("name", {presence: true, uniqueness: true})

export default Task
