import TenantOnlyGeneratorRecordBase from "../model-bases/tenant-only-generator-record.js"

export default class TenantOnlyGeneratorRecord extends TenantOnlyGeneratorRecordBase {}

TenantOnlyGeneratorRecord.setDatabaseIdentifier("projectTenant")
TenantOnlyGeneratorRecord.setEagerLoadRecordMetadata(false)
