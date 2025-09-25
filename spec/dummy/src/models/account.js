import DatabaseRecord from "../../../../src/database/record/index.js"

class Account extends DatabaseRecord {
}

Account.setDatabaseIdentifier("mssql")

export default Account
