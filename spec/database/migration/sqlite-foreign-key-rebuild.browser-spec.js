// @ts-check

import Configuration from "../../../src/configuration.js"
import {describe, expect, it} from "../../../src/testing/test.js"
import Migration from "../../../src/database/migration/index.js"

describe("database - migration - sqlite foreign-key rebuild", {tags: ["dummy"]}, () => {
  it("addForeignKey on SQLite registers a foreign key via table rebuild", async () => {
    const configuration = Configuration.current()

    await configuration.ensureConnections(async (dbs) => {
      const driver = dbs.default

      if (driver.getType() !== "sqlite") return

      const migration = new Migration({configuration, databaseIdentifier: "default", db: driver})

      await driver.query("DROP TABLE IF EXISTS fk_rebuild_posts")
      await driver.query("DROP TABLE IF EXISTS fk_rebuild_authors")

      await migration.createTable("fk_rebuild_authors", (table) => {
        table.string("name", {null: false})
      })

      await migration.createTable("fk_rebuild_posts", (table) => {
        table.string("title", {null: false})
        table.integer("author_id", {null: true})
      })

      await driver.addForeignKey("fk_rebuild_posts", "author_id", "fk_rebuild_authors", "id", {
        isNewForeignKey: true,
        name: "fk_rebuild_posts_author"
      })

      const table = await driver.getTableByNameOrFail("fk_rebuild_posts")
      const foreignKeys = await table.getForeignKeys()
      const referenced = foreignKeys.map((fk) => fk.getReferencedTableName())

      expect(referenced).toContain("fk_rebuild_authors")

      await migration.dropTable("fk_rebuild_posts")
      await migration.dropTable("fk_rebuild_authors")
    })
  })

  it("preserves existing data when rebuilding to add a foreign key", async () => {
    const configuration = Configuration.current()

    await configuration.ensureConnections(async (dbs) => {
      const driver = dbs.default

      if (driver.getType() !== "sqlite") return

      const migration = new Migration({configuration, databaseIdentifier: "default", db: driver})

      await driver.query("DROP TABLE IF EXISTS fk_data_posts")
      await driver.query("DROP TABLE IF EXISTS fk_data_authors")

      await migration.createTable("fk_data_authors", (table) => {
        table.string("name", {null: false})
      })

      await migration.createTable("fk_data_posts", (table) => {
        table.string("title", {null: false})
        table.integer("author_id", {null: true})
      })

      await driver.query("INSERT INTO fk_data_authors (name) VALUES ('Ada')")
      await driver.query("INSERT INTO fk_data_posts (title, author_id) VALUES ('hello', 1)")

      await driver.addForeignKey("fk_data_posts", "author_id", "fk_data_authors", "id", {
        isNewForeignKey: true,
        name: "fk_data_posts_author"
      })

      const rows = await driver.query("SELECT title, author_id FROM fk_data_posts")

      expect(rows.length).toEqual(1)
      expect(rows[0].title).toEqual("hello")
      expect(Number(rows[0].author_id)).toEqual(1)

      await migration.dropTable("fk_data_posts")
      await migration.dropTable("fk_data_authors")
    })
  })

  it("retargets a foreign key when its column is renamed in the same rebuild", async () => {
    const configuration = Configuration.current()

    await configuration.ensureConnections(async (dbs) => {
      const driver = dbs.default

      if (driver.getType() !== "sqlite") return

      const migration = new Migration({configuration, databaseIdentifier: "default", db: driver})

      await driver.query("DROP TABLE IF EXISTS fk_rename_posts")
      await driver.query("DROP TABLE IF EXISTS fk_rename_authors")

      await migration.createTable("fk_rename_authors", (table) => {
        table.string("name", {null: false})
      })

      await migration.createTable("fk_rename_posts", (table) => {
        table.string("title", {null: false})
        table.integer("author_id", {null: true})
      })

      await driver.addForeignKey("fk_rename_posts", "author_id", "fk_rename_authors", "id", {
        isNewForeignKey: true,
        name: "fk_rename_posts_author"
      })

      await migration.renameColumn("fk_rename_posts", "author_id", "writer_id")

      const table = await driver.getTableByNameOrFail("fk_rename_posts")
      const foreignKeys = await table.getForeignKeys()
      const fkColumns = foreignKeys.map((fk) => fk.getColumnName())

      expect(fkColumns).toContain("writer_id")
      expect(fkColumns).not.toContain("author_id")

      await migration.dropTable("fk_rename_posts")
      await migration.dropTable("fk_rename_authors")
    })
  })

  it("restores PRAGMA foreign_keys to its prior state after the rebuild", async () => {
    const configuration = Configuration.current()

    await configuration.ensureConnections(async (dbs) => {
      const driver = dbs.default

      if (driver.getType() !== "sqlite") return

      const migration = new Migration({configuration, databaseIdentifier: "default", db: driver})

      await driver.query("DROP TABLE IF EXISTS fk_state_posts")
      await driver.query("DROP TABLE IF EXISTS fk_state_authors")

      await migration.createTable("fk_state_authors", (table) => {
        table.string("name", {null: false})
      })

      await migration.createTable("fk_state_posts", (table) => {
        table.string("title", {null: false})
        table.integer("author_id", {null: true})
      })

      try {
        await driver.query("PRAGMA foreign_keys = OFF")

        await driver.addForeignKey("fk_state_posts", "author_id", "fk_state_authors", "id", {
          isNewForeignKey: true,
          name: "fk_state_posts_author"
        })

        const after = await driver.query("PRAGMA foreign_keys")

        expect(after[0]?.foreign_keys).toEqual(0)
      } finally {
        await driver.query("PRAGMA foreign_keys = ON")
      }

      await migration.dropTable("fk_state_posts")
      await migration.dropTable("fk_state_authors")
    })
  })

  it("preserves cross-table foreign keys pointing at the rebuilt table", async () => {
    const configuration = Configuration.current()

    await configuration.ensureConnections(async (dbs) => {
      const driver = dbs.default

      if (driver.getType() !== "sqlite") return

      const migration = new Migration({configuration, databaseIdentifier: "default", db: driver})

      await driver.query("DROP TABLE IF EXISTS fk_cross_comments")
      await driver.query("DROP TABLE IF EXISTS fk_cross_posts")
      await driver.query("DROP TABLE IF EXISTS fk_cross_authors")

      await migration.createTable("fk_cross_authors", (table) => {
        table.string("name", {null: false})
      })

      await migration.createTable("fk_cross_posts", (table) => {
        table.string("title", {null: false})
        table.integer("author_id", {null: true})
      })

      await migration.createTable("fk_cross_comments", (table) => {
        table.string("body", {null: false})
        table.integer("fk_cross_post_id", {foreignKey: true, null: true})
      })

      // Trigger a rebuild on fk_cross_posts. The fk_cross_comments → fk_cross_posts FK must
      // survive the DROP/RENAME swap because PRAGMA foreign_keys is toggled around the
      // rebuild and SQLite resolves cross-table references by name.
      await driver.addForeignKey("fk_cross_posts", "author_id", "fk_cross_authors", "id", {
        isNewForeignKey: true,
        name: "fk_cross_posts_author"
      })

      const commentsTable = await driver.getTableByNameOrFail("fk_cross_comments")
      const commentsFKs = await commentsTable.getForeignKeys()
      const referenced = commentsFKs.map((fk) => fk.getReferencedTableName())

      expect(referenced).toContain("fk_cross_posts")

      await migration.dropTable("fk_cross_comments")
      await migration.dropTable("fk_cross_posts")
      await migration.dropTable("fk_cross_authors")
    })
  })
})
