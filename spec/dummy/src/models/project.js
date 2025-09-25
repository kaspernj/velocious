import DatabaseRecord from "../../../../src/database/record/index.js"

class Project extends DatabaseRecord {
}

Project.belongsTo("creatingUser", {className: "User", foreignKey: "creating_user_reference", primaryKey: "reference"})
Project.hasMany("tasks")
Project.hasOne("projectDetail")
Project.translates("name")

export default Project
