// @ts-check

import ActsAsListItem from "../../dummy/src/models/acts-as-list-item.js"
import Project from "../../dummy/src/models/project.js"

describe("Record - acts as list", {tags: ["dummy"]}, () => {
  it("auto-appends to the end of the list when position is omitted", async () => {
    const project = await Project.create({name: "List Project A"})

    const item1 = await ActsAsListItem.create({name: "First", project})
    const item2 = await ActsAsListItem.create({name: "Second", project})

    expect(item1.position()).toEqual(1)
    expect(item2.position()).toEqual(2)
  })

  it("auto-appends independently within different scopes", async () => {
    const projectA = await Project.create({name: "List Project B1"})
    const projectB = await Project.create({name: "List Project B2"})

    const itemA1 = await ActsAsListItem.create({name: "A1", project: projectA})
    const itemB1 = await ActsAsListItem.create({name: "B1", project: projectB})
    const itemA2 = await ActsAsListItem.create({name: "A2", project: projectA})

    expect(itemA1.position()).toEqual(1)
    expect(itemB1.position()).toEqual(1)
    expect(itemA2.position()).toEqual(2)
  })

  it("bumps existing rows up when inserting at an occupied position", async () => {
    const project = await Project.create({name: "List Project C"})

    await ActsAsListItem.create({name: "Original 1", project})
    await ActsAsListItem.create({name: "Original 2", project})

    // Insert at position 1 — should bump the first two up
    const inserted = await ActsAsListItem.create({name: "Inserted", project, position: 1})

    expect(inserted.position()).toEqual(1)

    const allItems = await ActsAsListItem
      .where({projectId: project.id()})
      .order("position")
      .toArray()

    expect(allItems.length).toEqual(3)
    expect(allItems[0].name()).toEqual("Inserted")
    expect(allItems[0].position()).toEqual(1)
    expect(allItems[1].name()).toEqual("Original 1")
    expect(allItems[1].position()).toEqual(2)
    expect(allItems[2].name()).toEqual("Original 2")
    expect(allItems[2].position()).toEqual(3)
  })

  it("shifts rows down when moving an item to a higher position", async () => {
    const project = await Project.create({name: "List Project D"})

    const item1 = await ActsAsListItem.create({name: "Item 1", project})
    await ActsAsListItem.create({name: "Item 2", project})
    await ActsAsListItem.create({name: "Item 3", project})
    await ActsAsListItem.create({name: "Item 4", project})

    // Move item 1 from position 1 to position 3 — items 2 and 3 shift down
    await item1.update({position: 3})

    const allItems = await ActsAsListItem
      .where({projectId: project.id()})
      .order("position")
      .toArray()

    expect(allItems.length).toEqual(4)
    expect(allItems[0].name()).toEqual("Item 2")
    expect(allItems[0].position()).toEqual(1)
    expect(allItems[1].name()).toEqual("Item 3")
    expect(allItems[1].position()).toEqual(2)
    expect(allItems[2].name()).toEqual("Item 1")
    expect(allItems[2].position()).toEqual(3)
    expect(allItems[3].name()).toEqual("Item 4")
    expect(allItems[3].position()).toEqual(4)
  })

  it("shifts rows up when moving an item to a lower position", async () => {
    const project = await Project.create({name: "List Project E"})

    await ActsAsListItem.create({name: "Item 1", project})
    await ActsAsListItem.create({name: "Item 2", project})
    const item3 = await ActsAsListItem.create({name: "Item 3", project})

    // Move item 3 from position 3 to position 1 — items 1 and 2 shift up
    await item3.update({position: 1})

    const allItems = await ActsAsListItem
      .where({projectId: project.id()})
      .order("position")
      .toArray()

    expect(allItems.length).toEqual(3)
    expect(allItems[0].name()).toEqual("Item 3")
    expect(allItems[0].position()).toEqual(1)
    expect(allItems[1].name()).toEqual("Item 1")
    expect(allItems[1].position()).toEqual(2)
    expect(allItems[2].name()).toEqual("Item 2")
    expect(allItems[2].position()).toEqual(3)
  })

  it("closes the gap when an item is destroyed", async () => {
    const project = await Project.create({name: "List Project F"})

    await ActsAsListItem.create({name: "Item 1", project})
    const item2 = await ActsAsListItem.create({name: "Item 2", project})
    await ActsAsListItem.create({name: "Item 3", project})

    await item2.destroy()

    const allItems = await ActsAsListItem
      .where({projectId: project.id()})
      .order("position")
      .toArray()

    expect(allItems.length).toEqual(2)
    expect(allItems[0].name()).toEqual("Item 1")
    expect(allItems[0].position()).toEqual(1)
    expect(allItems[1].name()).toEqual("Item 3")
    expect(allItems[1].position()).toEqual(2)
  })

  it("shifts rows correctly when moving items between scopes", async () => {
    const projectA = await Project.create({name: "List Project G1"})
    const projectB = await Project.create({name: "List Project G2"})

    await ActsAsListItem.create({name: "A1", project: projectA})
    const itemA2 = await ActsAsListItem.create({name: "A2", project: projectA})
    await ActsAsListItem.create({name: "A3", project: projectA})

    await ActsAsListItem.create({name: "B1", project: projectB})
    await ActsAsListItem.create({name: "B2", project: projectB})

    // Move A2 from projectA to projectB — projectA should close gap, projectB should shift
    await itemA2.update({projectId: projectB.id()})

    const itemsA = await ActsAsListItem
      .where({projectId: projectA.id()})
      .order("position")
      .toArray()

    expect(itemsA.length).toEqual(2)
    expect(itemsA[0].name()).toEqual("A1")
    expect(itemsA[0].position()).toEqual(1)
    expect(itemsA[1].name()).toEqual("A3")
    expect(itemsA[1].position()).toEqual(2)

    const itemsB = await ActsAsListItem
      .where({projectId: projectB.id()})
      .order("position")
      .toArray()

    expect(itemsB.length).toEqual(3)
    expect(itemsB[0].name()).toEqual("B1")
    expect(itemsB[0].position()).toEqual(1)
    expect(itemsB[1].name()).toEqual("B2")
    expect(itemsB[1].position()).toEqual(2)
    expect(itemsB[2].name()).toEqual("A2")
    expect(itemsB[2].position()).toEqual(3)
  })

  it("appends without shifting target rows when moving between scopes without a new position", async () => {
    const projectA = await Project.create({name: "List Project I1"})
    const projectB = await Project.create({name: "List Project I2"})

    await ActsAsListItem.create({name: "A1", project: projectA})
    const itemA2 = await ActsAsListItem.create({name: "A2", project: projectA})
    await ActsAsListItem.create({name: "A3", project: projectA})

    await ActsAsListItem.create({name: "B1", project: projectB})
    await ActsAsListItem.create({name: "B2", project: projectB})

    await itemA2.update({projectId: projectB.id()})

    const itemsB = await ActsAsListItem
      .where({projectId: projectB.id()})
      .order("position")
      .toArray()

    expect(itemsB.map((item) => item.name())).toEqual(["B1", "B2", "A2"])
    expect(itemsB.map((item) => item.position())).toEqual([1, 2, 3])
  })

  it("shifts existing rows when inserting at an occupied position", async () => {
    const project = await Project.create({name: "List Project H"})

    await ActsAsListItem.create({name: "Item 1", project, position: 1})

    // Inserting at an already-occupied position bumps the existing row up
    const inserted = await ActsAsListItem.create({name: "Item 0", project, position: 1})

    const allItems = await ActsAsListItem
      .where({projectId: project.id()})
      .order("position")
      .toArray()

    expect(allItems.length).toEqual(2)
    expect(allItems[0].name()).toEqual("Item 0")
    expect(allItems[0].position()).toEqual(1)
    expect(allItems[1].name()).toEqual("Item 1")
    expect(allItems[1].position()).toEqual(2)
    expect(inserted.position()).toEqual(1)
  })
})
