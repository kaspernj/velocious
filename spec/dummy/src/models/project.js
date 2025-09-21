import DatabaseRecord from "../../../../src/database/record/index.js"

class Project extends DatabaseRecord {
}

Project.hasMany("tasks")
Project.hasOne("projectDetail")
Project.translates("name")

export default Project
