import ProjectBase from "../model-bases/project.js"

class Project extends ProjectBase {
}

Project.belongsTo("creatingUser", {className: "User", foreignKey: "creating_user_reference", primaryKey: "reference"})
Project.hasMany("tasks")
Project.hasOne("projectDetail")
Project.translates("name")

export default Project
