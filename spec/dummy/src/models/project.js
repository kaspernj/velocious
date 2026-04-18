import ProjectBase from "../model-bases/project.js"

class Project extends ProjectBase {
}

Project.belongsTo("creatingUser", {className: "User", foreignKey: "creating_user_reference", primaryKey: "reference"})
Project.hasMany("tasks", {dependent: "restrict"})
Project.hasMany("doneTasks", (scope) => scope.where({isDone: true}), {className: "Task"})
Project.hasOne("projectDetail")
Project.hasOne("activeProjectDetail", function() { return this.where({isActive: true}) }, {className: "ProjectDetail"})
Project.hasMany("interactions", {className: "Interaction", foreignKey: "subject_id", polymorphic: true})
Project.hasOne("primaryInteraction", {className: "Interaction", foreignKey: "subject_id", polymorphic: true})
Project.hasMany("comments", {className: "Comment", through: "tasks", foreignKey: "task_id"})
Project.translates("name")

Project.beforeValidation((record) => {
  if (record.readAttribute("tasksCount") == null) {
    record.setAttribute("tasksCount", 0)
  }
})

export default Project
