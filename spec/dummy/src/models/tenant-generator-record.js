import TenantGeneratorRecordBase from "../model-bases/tenant-generator-record.js"

export default class TenantGeneratorRecord extends TenantGeneratorRecordBase {}

TenantGeneratorRecord.setEagerLoadRecordMetadata(false)
TenantGeneratorRecord.switchesTenantDatabase(({tenant}) => tenant ? "projectTenant" : undefined)
