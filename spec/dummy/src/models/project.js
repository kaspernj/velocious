import ProjectBase from "../model-bases/project.js"

class Project extends ProjectBase {
}

Project.belongsTo("creatingUser", {className: "User", foreignKey: "creating_user_reference", primaryKey: "reference"})
Project.hasMany("tasks")
Project.hasOne("projectDetail")
Project.hasMany("interactions", {className: "Interaction", foreignKey: "subject_id", polymorphic: true})
Project.hasOne("primaryInteraction", {className: "Interaction", foreignKey: "subject_id", polymorphic: true})
Project.hasMany("comments", {className: "Comment", through: "tasks", foreignKey: "task_id"})
Project.translates("name")

export default Project
