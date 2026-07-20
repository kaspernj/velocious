import ProjectDetailsBase from "../model-bases/project-detail.js"

class ProjectDetail extends ProjectDetailsBase {
  static sync = {syncType: "upsert", track: ["create", "update"]}
}

ProjectDetail.belongsTo("project")

// Test fixture for base-model generation of state-machine methods. Uses the existing
// `note` column purely as the state column; no spec invokes these transitions, so the
// registered beforeSave/afterSave hooks stay inert. `archiveNow` (multi-word) pins the
// generated `canArchiveNow`/`canArchiveNowAsync` capitalization.
ProjectDetail.stateMachine({
  column: "note",
  initial: "draft",
  states: {draft: {}, published: {}, archived: {}},
  events: {
    publish: {from: "draft", to: "published"},
    archiveNow: {from: ["draft", "published"], to: "archived"}
  }
})

export default ProjectDetail
