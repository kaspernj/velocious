import ProjectDetailsBase from "../model-bases/project-detail.js"

class ProjectDetail extends ProjectDetailsBase {
  static sync = {syncType: "upsert", track: ["create", "update"]}
}

ProjectDetail.belongsTo("project")

export default ProjectDetail
