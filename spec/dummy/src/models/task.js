import TaskBase from "../model-bases/task.js"

class Task extends TaskBase {
}

Task.belongsTo("project")
Task.hasMany("interactions", {className: "Interaction", foreignKey: "subject_id", polymorphic: true})
Task.hasOne("primaryInteraction", {className: "Interaction", foreignKey: "subject_id", polymorphic: true})
Task.validates("name", {presence: true, uniqueness: true})

export default Task
