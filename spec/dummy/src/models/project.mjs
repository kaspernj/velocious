import DatabaseRecord from "../../../../src/database/record/index.mjs"

class Project extends DatabaseRecord {
}

Project.hasMany("tasks")
Project.translates("name")

export default Project
