import DatabaseRecord from "../../../../src/database/record/index.js"

class ProjectDetail extends DatabaseRecord {
}

ProjectDetail.belongsTo("project")

export default ProjectDetail
