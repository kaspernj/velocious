import UuidItemBase from "../model-bases/uuid-item.js"

class UuidItem extends UuidItemBase {
  static sync = {
    /** @param {{data: {title?: string | null}}} args - Pushed/pulled change payload. @returns {{title: string | null | undefined}} - Applied attributes. */
    attributes: ({data}) => ({title: data.title}),
    track: true
  }
}

UuidItem.hasMany("uuidInteractions", {className: "UuidInteraction", foreignKey: "subject_id", polymorphic: true})

export default UuidItem
