import Dummy from "../../dummy/index.js"
import StringSubject from "../../dummy/src/models/string-subject.js"
import StringSubjectInteraction from "../../dummy/src/models/string-subject-interaction.js"
import UuidInteraction from "../../dummy/src/models/uuid-interaction.js"
import UuidItem from "../../dummy/src/models/uuid-item.js"

describe("Record - polymorphic id types", () => {
  it("supports polymorphic references with string and uuid ids", async () => {
    await Dummy.run(async () => {
      const stringSubject = await StringSubject.create({id: "subject-1", name: "String subject"})
      await StringSubjectInteraction.create({kind: "string-kind", subjectId: stringSubject.id(), subjectType: "StringSubject"})

      const uuidItem = await UuidItem.create({title: "UUID subject"})
      await UuidInteraction.create({kind: "uuid-kind", subjectId: uuidItem.id(), subjectType: "UuidItem"})

      const foundStringSubject = /** @type {StringSubject} */ (await StringSubject.preload({stringSubjectInteractions: true}).find(stringSubject.id()))
      const stringKinds = foundStringSubject.stringSubjectInteractionsLoaded().map((interaction) => interaction.kind())

      const foundUuidItem = /** @type {UuidItem} */ (await UuidItem.preload({uuidInteractions: true}).find(uuidItem.id()))
      const uuidKinds = foundUuidItem.uuidInteractionsLoaded().map((interaction) => interaction.kind())

      expect(stringKinds).toEqual(["string-kind"])
      expect(uuidKinds).toEqual(["uuid-kind"])
    })
  })
})
