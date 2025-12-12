import ProjectDetailsBase from "../model-bases/project-detail.js"

class ProjectDetail extends ProjectDetailsBase {
}

ProjectDetail.belongsTo("project")

export default ProjectDetail
