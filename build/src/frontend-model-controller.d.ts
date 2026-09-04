import Controller from "./controller.js";
export type FrontendModelSearch = {
    /**
     * - Relationship path.
     */
    path: string[];
    /**
     * - Column or attribute name.
     */
    column: string;
    /**
     * - Search operator.
     */
    operator: "eq" | "like" | "notEq" | "gt" | "gteq" | "lt" | "lteq";
    /**
     * - Search value.
     */
    value: ReturnType<typeof JSON.parse>;
};
export type FrontendModelSort = {
    /**
     * - Attribute name to sort by.
     */
    column: string;
    /**
     * - Sort direction.
     */
    direction: "asc" | "desc";
    /**
     * - Relationship path from root model.
     */
    path: string[];
};
export type FrontendModelGroup = {
    /**
     * - Attribute name to group by.
     */
    column: string;
    /**
     * - Relationship path from root model.
     */
    path: string[];
};
export type FrontendModelPluck = {
    /**
     * - Attribute name to pluck.
     */
    column: string;
    /**
     * - Relationship path from root model.
     */
    path: string[];
};
export type FrontendModelPagination = {
    /**
     * - Maximum number of records.
     */
    limit: number | null;
    /**
     * - Number of records to skip.
     */
    offset: number | null;
    /**
     * - 1-based page number.
     */
    page: number | null;
    /**
     * - Page size.
     */
    perPage: number | null;
};
export type FrontendModelEndpointErrorContext = import("./configuration-types.js").ClientErrorPayloadContext & {
    action: string;
    expectedError: boolean;
    frontendModelEndpoint: true;
};
export type FrontendModelIndexQueryOptions = {
    /**
     * - Whether frontend-model pagination params should be applied.
     */
    includePagination?: boolean;
    /**
     * - Whether frontend-model sort params should be applied.
     */
    includeSort?: boolean;
    /**
     * - Resource providing query hooks.
     */
    resource?: Pick<import("./frontend-model-resource/base-resource.js").default<import("./frontend-model-resource/base-resource.js").FrontendModelResourceModelClass>, "applyFrontendModelIndexPagination" | "applyFrontendModelIndexSearch" | "applyFrontendModelIndexSort">;
};
export type FrontendModelQueryMetadata = import("./database/query/model-class-query.js").default & Record<symbol, Set<string> | undefined>;
export type FrontendModelSerializationResourceInstanceHook = (model: import("./database/record/index.js").default, resource: import("./frontend-model-resource/base-resource.js").default | null) => void;
/** Controller with built-in frontend model resource actions. */
export default class FrontendModelController extends Controller {
    /**
     * Frontend model params.
     * @type {Record<string, ReturnType<typeof JSON.parse>> | undefined} */
    _frontendModelParams: Record<string, ReturnType<typeof JSON.parse>> | undefined;
    /**
     * Frontend model params override.
     * @type {Record<string, ReturnType<typeof JSON.parse>> | undefined} */
    _frontendModelParamsOverride: Record<string, ReturnType<typeof JSON.parse>> | undefined;
    /**
     * Frontend model ability override.
     * @type {import("./authorization/ability.js").default | undefined} */
    _frontendModelAbilityOverride: import("./authorization/ability.js").default | undefined;
    /**
     * Original deserialized custom-command client payload, captured before route
     * framework params are merged in, so a typed command method receives the client's
     * own arguments rather than the route metadata. Only set on the shared-endpoint path.
     * @type {Record<string, ReturnType<typeof JSON.parse>> | undefined} */
    _frontendModelCustomCommandClientArguments: Record<string, ReturnType<typeof JSON.parse>> | undefined;
    /**
     * Request-scoped cache for serialization resource instances.
     * Keyed by model class, then by whether the resource is for a related model
     * (so self-referential relationships do not accidentally reuse root params).
     * @type {Map<typeof import("./database/record/index.js").default, Map<boolean, import("./frontend-model-resource/base-resource.js").default>> | undefined} */
    _frontendModelSerializationResourceInstances: Map<typeof import("./database/record/index.js").default, Map<boolean, import("./frontend-model-resource/base-resource.js").default>> | undefined;
    /**
     * Optional per-instance hook invoked for every serialization resource instance
     * resolution. Intended for tests and benchmarks; absent in production.
     * @type {FrontendModelSerializationResourceInstanceHook | null | undefined} */
    _frontendModelSerializationResourceInstanceHook: FrontendModelSerializationResourceInstanceHook | null | undefined;
    /**
     * Runs frontend model params.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Decoded request params.
     */
    frontendModelParams(): Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * Runs with frontend model params.
     * @template T
     * @param {Record<string, ReturnType<typeof JSON.parse>>} params - Temporary frontend model params.
     * @param {() => Promise<T>} callback - Callback executed with temporary params.
     * @returns {Promise<T>} - Callback return value.
     */
    withFrontendModelParams<T>(params: Record<string, ReturnType<typeof JSON.parse>>, callback: () => Promise<T>): Promise<T>;
    /**
     * Runs with frontend model request context.
     * @template T
     * @param {Record<string, ReturnType<typeof JSON.parse>>} params - Request-scoped params.
     * @param {import("./http-server/client/response.js").default} response - Response instance.
     * @param {() => Promise<T>} callback - Callback executed inside resolved tenant and ability context.
     * @returns {Promise<T>} - Callback return value.
     */
    withFrontendModelRequestContext<T>(params: Record<string, ReturnType<typeof JSON.parse>>, response: import("./http-server/client/response.js").default, callback: () => Promise<T>): Promise<T>;
    /**
     * Runs current ability.
     * @returns {import("./authorization/ability.js").default | undefined} - Current ability for frontend-model request scope.
     */
    currentAbility(): import("./authorization/ability.js").default | undefined;
    /**
     * Runs frontend model class.
     * @returns {typeof import("./database/record/index.js").default} - Frontend model class for controller resource actions.
     */
    frontendModelClass(): typeof import("./database/record/index.js").default;
    /**
     * Runs frontend model resource configuration.
     * @returns {{backendProject: import("./configuration-types.js").BackendProjectConfiguration, modelName: string, resourceClass: import("./configuration-types.js").FrontendModelResourceClassType, resourceConfiguration: import("./configuration-types.js").NormalizedFrontendModelResourceConfiguration} | null} - Frontend model resource configuration for current controller.
     */
    frontendModelResourceConfiguration(): {
        backendProject: import("./configuration-types.js").BackendProjectConfiguration;
        modelName: string;
        resourceClass: import("./configuration-types.js").FrontendModelResourceClassType;
        resourceConfiguration: import("./configuration-types.js").NormalizedFrontendModelResourceConfiguration;
    } | null;
    /**
     * Runs frontend model resource configuration for backend project model name.
     * @param {object} args - Arguments.
     * @param {import("./configuration-types.js").BackendProjectConfiguration} args.backendProject - Backend project configuration.
     * @param {string} args.modelName - Model name.
     * @returns {{backendProject: import("./configuration-types.js").BackendProjectConfiguration, modelName: string, resourceClass: import("./configuration-types.js").FrontendModelResourceClassType, resourceConfiguration: import("./configuration-types.js").NormalizedFrontendModelResourceConfiguration} | null} - Frontend model resource configuration for model name.
     */
    frontendModelResourceConfigurationForBackendProjectModelName({ backendProject, modelName }: {
        backendProject: import("./configuration-types.js").BackendProjectConfiguration;
        modelName: string;
    }): {
        backendProject: import("./configuration-types.js").BackendProjectConfiguration;
        modelName: string;
        resourceClass: import("./configuration-types.js").FrontendModelResourceClassType;
        resourceConfiguration: import("./configuration-types.js").NormalizedFrontendModelResourceConfiguration;
    } | null;
    /**
     * Runs frontend model resource configuration for model class.
     * @param {typeof import("./database/record/index.js").default} modelClass - Model class.
     * @returns {{backendProject: import("./configuration-types.js").BackendProjectConfiguration, modelName: string, resourceClass: import("./configuration-types.js").FrontendModelResourceClassType, resourceConfiguration: import("./configuration-types.js").NormalizedFrontendModelResourceConfiguration} | null} - Frontend model resource configuration for model class.
     */
    frontendModelResourceConfigurationForModelClass(modelClass: typeof import("./database/record/index.js").default): {
        backendProject: import("./configuration-types.js").BackendProjectConfiguration;
        modelName: string;
        resourceClass: import("./configuration-types.js").FrontendModelResourceClassType;
        resourceConfiguration: import("./configuration-types.js").NormalizedFrontendModelResourceConfiguration;
    } | null;
    /**
     * Runs frontend model resource model class.
     * @param {{modelName: string, resourceClass: import("./configuration-types.js").FrontendModelResourceClassType}} frontendModelResource - Frontend model resource configuration.
     * @returns {typeof import("./database/record/index.js").default} - Backing record class.
     */
    frontendModelResourceModelClass(frontendModelResource: {
        modelName: string;
        resourceClass: import("./configuration-types.js").FrontendModelResourceClassType;
    }): typeof import("./database/record/index.js").default;
    /**
     * Runs frontend model class from configuration.
     * @returns {typeof import("./database/record/index.js").default | null} - Frontend model class resolved from backend project configuration.
     */
    frontendModelClassFromConfiguration(): typeof import("./database/record/index.js").default | null;
    /**
     * Ensures the frontend model class and requested preload target classes are initialized.
     * This handles the case where model initialization was skipped at startup (e.g., browser tests).
     * @returns {Promise<void>} - Resolves when the model class is ready.
     */
    ensureFrontendModelClassInitialized(): Promise<void>;
    /**
     * Runs ensure frontend model record class initialized.
     * @param {typeof import("./database/record/index.js").default} modelClass - Model class to initialize.
     * @returns {Promise<void>} - Resolves when the model class is ready.
     */
    ensureFrontendModelRecordClassInitialized(modelClass: typeof import("./database/record/index.js").default): Promise<void>;
    /**
     * Runs ensure frontend model preload classes initialized.
     * @param {object} args - Arguments.
     * @param {import("./configuration-types.js").BackendProjectConfiguration} args.backendProject - Backend project configuration.
     * @param {typeof import("./database/record/index.js").default} args.modelClass - Model class whose preload tree is being resolved.
     * @param {import("./database/query/index.js").NestedPreloadRecord | null} args.preload - Normalized preload tree.
     * @returns {Promise<void>} - Resolves when preload target classes are initialized.
     */
    ensureFrontendModelPreloadClassesInitialized({ backendProject, modelClass, preload }: {
        backendProject: import("./configuration-types.js").BackendProjectConfiguration;
        modelClass: typeof import("./database/record/index.js").default;
        preload: import("./database/query/index.js").NestedPreloadRecord | null;
    }): Promise<void>;
    /**
     * Runs ensure frontend model relationship target class initialized.
     * @param {object} args - Arguments.
     * @param {import("./configuration-types.js").BackendProjectConfiguration} args.backendProject - Backend project configuration.
     * @param {import("./database/record/relationships/base.js").default} args.relationship - Relationship definition.
     * @returns {Promise<typeof import("./database/record/index.js").default | null>} - Target model class, when available.
     */
    ensureFrontendModelRelationshipTargetClassInitialized({ backendProject, relationship }: {
        backendProject: import("./configuration-types.js").BackendProjectConfiguration;
        relationship: import("./database/record/relationships/base.js").default;
    }): Promise<typeof import("./database/record/index.js").default | null>;
    /**
     * Runs frontend model relationship target model class.
     * @param {object} args - Arguments.
     * @param {import("./configuration-types.js").BackendProjectConfiguration} args.backendProject - Backend project configuration.
     * @param {import("./database/record/relationships/base.js").default} args.relationship - Relationship definition.
     * @returns {typeof import("./database/record/index.js").default | null} - Target model class, when available.
     */
    frontendModelRelationshipTargetModelClass({ backendProject, relationship }: {
        backendProject: import("./configuration-types.js").BackendProjectConfiguration;
        relationship: import("./database/record/relationships/base.js").default;
    }): typeof import("./database/record/index.js").default | null;
    /**
     * Runs frontend model resource path.
     * @param {string} modelName - Model class name.
     * @param {ReturnType<typeof JSON.parse>} resourceDefinition - Resource definition.
     * @returns {string} - Normalized resource path.
     */
    frontendModelResourcePath(modelName: string, resourceDefinition: ReturnType<typeof JSON.parse>): string;
    /**
     * Runs frontend model resource matches controller.
     * @param {object} args - Arguments.
     * @param {string} args.controllerName - Controller name from params.
     * @param {string} args.resourcePath - Resource path from configuration.
     * @returns {boolean} - Whether resource path matches current controller.
     */
    frontendModelResourceMatchesController({ controllerName, resourcePath }: {
        controllerName: string;
        resourcePath: string;
    }): boolean;
    /**
     * Runs frontend model resource instance.
     * @returns {import("./frontend-model-resource/base-resource.js").default} - Backend resource instance for current frontend-model action.
     */
    frontendModelResourceInstance(): import("./frontend-model-resource/base-resource.js").default;
    /**
     * Runs frontend model primary key.
     * @returns {import("./utils/model-primary-key.js").ModelPrimaryKeyDefinition} - Frontend model primary key.
     */
    frontendModelPrimaryKey(): import("./utils/model-primary-key.js").ModelPrimaryKeyDefinition;
    /**
     * Runs frontend model ability action.
     * @param {"index" | "find" | "create" | "update" | "destroy" | "attach" | "attachmentList" | "download" | "url"} action - Frontend action.
     * @returns {string} - Ability action configured for the frontend action.
     */
    frontendModelAbilityAction(action: "index" | "find" | "create" | "update" | "destroy" | "attach" | "attachmentList" | "download" | "url"): string;
    /**
     * Runs frontend model ability authorized query.
     * @param {"index" | "find" | "create" | "update" | "destroy" | "attach" | "attachmentList" | "download" | "url"} action - Frontend action.
     * @param {{ruleQueryFactory?: () => import("./database/query/model-class-query.js").default<typeof import("./database/record/index.js").default>}} [options] - Authorization query options.
     * @returns {import("./database/query/model-class-query.js").default<typeof import("./database/record/index.js").default>} - Authorized query for the action.
     */
    frontendModelAbilityAuthorizedQuery(action: "index" | "find" | "create" | "update" | "destroy" | "attach" | "attachmentList" | "download" | "url", { ruleQueryFactory }?: {
        ruleQueryFactory?: () => import("./database/query/model-class-query.js").default<typeof import("./database/record/index.js").default>;
    }): import("./database/query/model-class-query.js").default<typeof import("./database/record/index.js").default>;
    /**
     * Runs frontend model authorized query.
     * @param {"index" | "find" | "create" | "update" | "destroy" | "attach" | "attachmentList" | "download" | "url"} action - Frontend action.
     * @param {{ruleQueryFactory?: () => import("./database/query/model-class-query.js").default<typeof import("./database/record/index.js").default>}} [options] - Authorization query options.
     * @returns {import("./database/query/model-class-query.js").default<typeof import("./database/record/index.js").default>} - Authorized query for the action.
     */
    frontendModelAuthorizedQuery(action: "index" | "find" | "create" | "update" | "destroy" | "attach" | "attachmentList" | "download" | "url", options?: {
        ruleQueryFactory?: () => import("./database/query/model-class-query.js").default<typeof import("./database/record/index.js").default>;
    }): import("./database/query/model-class-query.js").default<typeof import("./database/record/index.js").default>;
    /**
     * Runs frontend model primary key value.
     * @param {import("./database/record/index.js").default} model - Model instance.
     * @returns {import("./utils/model-primary-key.js").ModelPrimaryKeyValue} - Primary key value.
     */
    frontendModelPrimaryKeyValue(model: import("./database/record/index.js").default): import("./utils/model-primary-key.js").ModelPrimaryKeyValue;
    /**
     * Returns the authorized identities from a candidate cohort without per-record queries.
     * @param {object} args - Arguments.
     * @param {import("./utils/model-primary-key.js").ModelPrimaryKeyValue[]} args.identities - Candidate identities.
     * @param {typeof import("./database/record/index.js").default} args.modelClass - Model class owning the identity attributes.
     * @param {import("./utils/model-primary-key.js").ModelPrimaryKeyDefinition} args.primaryKey - Identity definition.
     * @param {import("./database/query/model-class-query.js").default<typeof import("./database/record/index.js").default>} args.query - Authorized query.
     * @returns {Promise<Set<string>>} - Canonical authorized identity keys.
     */
    frontendModelAuthorizedIdentitySet({ identities, modelClass, primaryKey, query }: {
        identities: import("./utils/model-primary-key.js").ModelPrimaryKeyValue[];
        modelClass: typeof import("./database/record/index.js").default;
        primaryKey: import("./utils/model-primary-key.js").ModelPrimaryKeyDefinition;
        query: import("./database/query/model-class-query.js").default<typeof import("./database/record/index.js").default>;
    }): Promise<Set<string>>;
    /**
     * Runs frontend model filter authorized models.
     * @param {object} args - Arguments.
     * @param {"index" | "find" | "create" | "update" | "destroy" | "attach" | "attachmentList" | "download" | "url"} args.action - Frontend action.
     * @param {import("./database/record/index.js").default[]} args.models - Candidate models.
     * @returns {Promise<import("./database/record/index.js").default[]>} - Authorized models.
     */
    frontendModelFilterAuthorizedModels({ action, models }: {
        action: "index" | "find" | "create" | "update" | "destroy" | "attach" | "attachmentList" | "download" | "url";
        models: import("./database/record/index.js").default[];
    }): Promise<import("./database/record/index.js").default[]>;
    /**
     * Runs run frontend model before action.
     * @param {"index" | "find" | "create" | "update" | "destroy" | "attach" | "attachmentList" | "download" | "url"} action - Frontend action.
     * @returns {Promise<boolean>} - Whether action should continue.
     */
    runFrontendModelBeforeAction(action: "index" | "find" | "create" | "update" | "destroy" | "attach" | "attachmentList" | "download" | "url"): Promise<boolean>;
    /**
     * Runs frontend model find record.
     * @param {"find" | "update" | "destroy" | "attach" | "attachmentList" | "download" | "url"} action - Frontend action.
     * @param {import("./utils/model-primary-key.js").ModelPrimaryKeyValue} id - Record id.
     * @returns {Promise<import("./database/record/index.js").default | null>} - Located model record.
     */
    frontendModelFindRecord(action: "find" | "update" | "destroy" | "attach" | "attachmentList" | "download" | "url", id: import("./utils/model-primary-key.js").ModelPrimaryKeyValue): Promise<import("./database/record/index.js").default | null>;
    /**
     * Runs frontend model create record.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} attributes - Create attributes.
     * @param {Record<string, ReturnType<typeof JSON.parse>> | null} [nestedAttributes] - Optional nested-attribute payload for cascading writes.
     * @param {Record<string, ReturnType<typeof JSON.parse>> | null} [attachments] - Optional attachment payloads keyed by attachment name.
     * @returns {Promise<import("./database/record/index.js").default | null>} - Created model when authorized.
     */
    frontendModelCreateRecord(attributes: Record<string, ReturnType<typeof JSON.parse>>, nestedAttributes?: Record<string, ReturnType<typeof JSON.parse>> | null, attachments?: Record<string, ReturnType<typeof JSON.parse>> | null): Promise<import("./database/record/index.js").default | null>;
    /**
     * Runs frontend model records.
     * @returns {Promise<import("./database/record/index.js").default[]>} - Frontend model records.
     */
    frontendModelRecords(): Promise<import("./database/record/index.js").default[]>;
    /**
     * Runs frontend model preload.
     * @returns {import("./database/query/index.js").NestedPreloadRecord | null} - Frontend preload data.
     */
    frontendModelPreload(): import("./database/query/index.js").NestedPreloadRecord | null;
    /**
     * Runs frontend model select.
     * @returns {Record<string, string[]> | null} - Frontend select data.
     */
    frontendModelSelect(): Record<string, string[]> | null;
    /**
     * Runs frontend model selects extra.
     * @returns {Record<string, string[]> | null} - Frontend extra-select data (defaults plus these), keyed by model name.
     */
    frontendModelSelectsExtra(): Record<string, string[]> | null;
    /**
     * Runs frontend model searches.
     * @returns {FrontendModelSearch[]} - Frontend search filters.
     */
    frontendModelSearches(): FrontendModelSearch[];
    /**
     * Runs frontend model where.
     * @returns {Record<string, ReturnType<typeof JSON.parse>> | null} - Frontend where filters.
     */
    frontendModelWhere(): Record<string, ReturnType<typeof JSON.parse>> | null;
    /**
     * Runs frontend model ransack.
     * @returns {Record<string, ReturnType<typeof JSON.parse>> | null} - Frontend Ransack filters.
     */
    frontendModelRansack(): Record<string, ReturnType<typeof JSON.parse>> | null;
    /**
     * Runs frontend model joins.
     * @returns {Record<string, ReturnType<typeof JSON.parse>> | null} - Frontend joins descriptors.
     */
    frontendModelJoins(): Record<string, ReturnType<typeof JSON.parse>> | null;
    /**
     * Runs frontend model sort.
     * @returns {FrontendModelSort[]} - Frontend sort definitions.
     */
    frontendModelSort(): FrontendModelSort[];
    /**
     * Runs frontend model group.
     * @returns {FrontendModelGroup[]} - Frontend group definitions.
     */
    frontendModelGroup(): FrontendModelGroup[];
    /**
     * Runs frontend model pagination.
     * @returns {FrontendModelPagination} - Frontend pagination params.
     */
    frontendModelPagination(): FrontendModelPagination;
    /**
     * Runs frontend model distinct.
     * @returns {boolean | null} - Frontend distinct flag when provided.
     */
    frontendModelDistinct(): boolean | null;
    /**
     * Runs frontend model pluck.
     * @returns {FrontendModelPluck[]} - Frontend pluck definitions.
     */
    frontendModelPluck(): FrontendModelPluck[];
    /**
     * Runs frontend model count requested.
     * @returns {boolean} - Whether the request asks for an aggregate count.
     */
    frontendModelCountRequested(): boolean;
    /**
     * Runs frontend model with count.
     * @returns {Array<{attributeName: string, relationshipName: string, where?: Record<string, ReturnType<typeof JSON.parse>>}>}
     *   Frontend withCount entries. Empty array when not requested.
     */
    frontendModelWithCount(): Array<{
        attributeName: string;
        relationshipName: string;
        where?: Record<string, ReturnType<typeof JSON.parse>>;
    }>;
    /**
     * Resolve an entry from the frontend-model `abilities` payload to
     * its backend model class by looking up the resource by modelName
     * across all configured backend projects. Returns null when no
     * resource matches the user-provided ability entry.
     * @param {string} modelName - Frontend model name from an ability request.
     * @returns {typeof import("./database/record/index.js").default | null} - Backend model class exposed under that frontend name, if present.
     */
    _frontendModelClassForAbilities(modelName: string): typeof import("./database/record/index.js").default | null;
    /**
     * Collect every loaded record whose `getModelName()` matches the
     * requested name, walking across the root-level slice plus any
     * preloaded relationships at any depth. Used to evaluate per-record
     * abilities against nested preloaded children with a single batched
     * query per (modelClass, action) pair.
     * @param {import("./database/record/index.js").default[]} rootModels - Loaded roots whose relationship graphs should be traversed.
     * @param {string} modelName - Model name records must match.
     * @returns {import("./database/record/index.js").default[]} - Matching records reachable from the loaded roots.
     */
    _frontendModelCollectRecordsForName(rootModels: import("./database/record/index.js").default[], modelName: string): import("./database/record/index.js").default[];
    /**
     * Evaluate every ability requested via the frontend `abilities`
     * param against the loaded model cohort (plus any preloaded
     * children), attaching the results to each record via
     * `_setComputedAbility`. Runs one batched `authorized query + pluck`
     * per (modelClass, action) pair, regardless of how many records
     * were loaded.
     * @param {import("./database/record/index.js").default[]} rootModels - Loaded roots that receive computed ability results.
     * @returns {Promise<void>}
     */
    frontendModelComputeAbilities(rootModels: import("./database/record/index.js").default[]): Promise<void>;
    /**
     * Parse the frontend-model `abilities` param into a list of
     * `{modelName, actions}` entries to evaluate against loaded records.
     * Unknown entries are silently skipped — downstream code resolves
     * model names to classes when applying the check, so unresolved
     * names naturally become no-ops.
     * @returns {Array<{modelName: string, actions: string[]}>} - Normalized model ability requests.
     */
    frontendModelAbilities(): Array<{
        modelName: string;
        actions: string[];
    }>;
    /**
     * Read the frontend-model `queryData` param. The wire format carries
     * only **names** (the keys the frontend wants attached) plus the
     * optional nested-relationship chain leading to them — the actual SQL
     * fragments live on the backend model as `Model.queryData(name, fn)`
     * registrations. Callers cannot push SQL through this endpoint.
     *
     * Returns the raw nested-record spec (shape validated by the
     * normalizer inside `Query.queryData`) or `null` when not requested.
     * @returns {import("./database/query/query-data.js").QueryDataSpec | null} - Normalized query-data specification.
     */
    frontendModelQueryData(): import("./database/query/query-data.js").QueryDataSpec | null;
    /**
     * Runs frontend model index query.
     * @param {FrontendModelIndexQueryOptions} [options] - Index query options.
     * @returns {import("./database/query/model-class-query.js").default} - Frontend index query with normalized params applied.
     */
    frontendModelIndexQuery(options?: FrontendModelIndexQueryOptions): import("./database/query/model-class-query.js").default;
    /**
     * MSSQL cannot apply DISTINCT over non-comparable text columns in table.* selects.
     * This rewrites distinct frontend-model queries to select root records by distinct PK subquery.
     * @param {object} args - Args.
     * @param {import("./database/query/model-class-query.js").default} args.query - Query with distinct and filters.
     * @returns {import("./database/query/model-class-query.js").default} - MSSQL-safe distinct query.
     */
    frontendModelMssqlDistinctByPrimaryKeyQuery({ query }: {
        query: import("./database/query/model-class-query.js").default;
    }): import("./database/query/model-class-query.js").default;
    /**
     * Runs frontend model pluck values.
     * @param {object} args - Pluck args.
     * @param {import("./database/query/model-class-query.js").default} args.query - Query instance.
     * @param {FrontendModelPluck[]} args.pluck - Pluck descriptors.
     * @returns {Promise<Array<ReturnType<typeof JSON.parse>>>} - Plucked values.
     */
    frontendModelPluckValues({ query, pluck }: {
        query: import("./database/query/model-class-query.js").default;
        pluck: FrontendModelPluck[];
    }): Promise<Array<ReturnType<typeof JSON.parse>>>;
    /**
     * Resolves a frontend-model pluck attribute to a database column.
     * @param {{attributeName: string, modelClass: typeof import("./database/record/index.js").default}} args - Arguments.
     * @returns {string | undefined} Resolved DB column name.
     */
    resolveFrontendModelPluckColumnName({ attributeName, modelClass }: {
        attributeName: string;
        modelClass: typeof import("./database/record/index.js").default;
    }): string | undefined;
    /**
     * Runs exposed frontend-model resource attribute names for a model class.
     * @param {typeof import("./database/record/index.js").default} modelClass - Model class.
     * @returns {Set<string> | null} Exposed resource attribute names, or null when the resource exposes all DB-backed model attributes.
     */
    frontendModelResourceAttributeNamesForModelClass(modelClass: typeof import("./database/record/index.js").default): Set<string> | null;
    /**
     * Runs exposed frontend-model resource attribute names.
     * @param {import("./configuration-types.js").FrontendModelResourceConfiguration["attributes"]} attributes - Resource attributes.
     * @returns {Set<string>} Exposed resource attribute names.
     */
    frontendModelResourceAttributeNames(attributes: import("./configuration-types.js").FrontendModelResourceConfiguration["attributes"]): Set<string>;
    /**
     * Asserts frontend-model pluck definitions only reference exposed resource attributes.
     * @param {FrontendModelPluck[]} pluck - Pluck descriptors.
     * @returns {void}
     */
    assertFrontendModelPluckDefinitionsAllowed(pluck: FrontendModelPluck[]): void;
    /**
     * Asserts frontend-model Ransack definitions only reference exposed resource attributes.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} ransack - Ransack descriptor.
     * @returns {void}
     */
    assertFrontendModelRansackAllowed(ransack: Record<string, ReturnType<typeof JSON.parse>>): void;
    /**
     * Runs normalized frontend-model Ransack group.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} filterParams - Ransack filter params.
     * @returns {import("./utils/ransack.js").RansackGroup} Normalized Ransack group.
     */
    frontendModelRansackGroup(filterParams: Record<string, ReturnType<typeof JSON.parse>>): import("./utils/ransack.js").RansackGroup;
    /**
     * Runs normalized frontend-model Ransack sorts.
     * @param {string} sortString - Ransack sort string.
     * @returns {import("./utils/ransack.js").RansackSort[]} Normalized Ransack sorts.
     */
    frontendModelRansackSorts(sortString: string): import("./utils/ransack.js").RansackSort[];
    /**
     * Asserts a normalized frontend-model Ransack group only references exposed attributes.
     * @param {object} args - Assertion args.
     * @param {import("./utils/ransack.js").RansackGroup} args.group - Ransack group.
     * @returns {void}
     */
    assertFrontendModelRansackGroupAllowed({ group }: {
        group: import("./utils/ransack.js").RansackGroup;
    }): void;
    /**
     * Asserts one normalized frontend-model Ransack attribute is exposed by its resource.
     * @param {object} args - Assertion args.
     * @param {string} args.attributeName - Attribute name.
     * @param {typeof import("./database/record/index.js").default} args.modelClass - Target model class.
     * @param {string} args.operationName - Operation name for errors.
     * @returns {void}
     */
    assertFrontendModelRansackAttributeAllowed({ attributeName, modelClass, operationName }: {
        attributeName: string;
        modelClass: typeof import("./database/record/index.js").default;
        operationName: string;
    }): void;
    /**
     * Runs frontend model search target model class.
     * @param {object} args - Search args.
     * @param {typeof import("./database/record/index.js").default} args.modelClass - Root model class.
     * @param {string[]} args.path - Relationship path.
     * @returns {typeof import("./database/record/index.js").default} - Target model class.
     */
    frontendModelSearchTargetModelClass({ modelClass, path }: {
        modelClass: typeof import("./database/record/index.js").default;
        path: string[];
    }): typeof import("./database/record/index.js").default;
    /**
     * Runs apply frontend model search.
     * @param {object} args - Search args.
     * @param {import("./database/query/model-class-query.js").default} args.query - Query instance.
     * @param {FrontendModelSearch} args.search - Search filter.
     * @returns {void}
     */
    applyFrontendModelSearch({ query, search }: {
        query: import("./database/query/model-class-query.js").default;
        search: FrontendModelSearch;
    }): void;
    /**
     * Apply array-valued equality search filters.
     * @param {object} args - Search arguments.
     * @param {string} args.columnSql - SQL for the searched column.
     * @param {string} args.emptySql - SQL predicate used when the array is empty.
     * @param {"IN" | "NOT IN"} args.operatorSql - SQL array operator.
     * @param {import("./database/query/model-class-query.js").default} args.query - Query instance.
     * @param {FrontendModelSearch} args.search - Search descriptor.
     * @returns {boolean} - Whether an array predicate was applied.
     */
    applyFrontendModelArraySearch({ columnSql, emptySql, operatorSql, query, search }: {
        columnSql: string;
        emptySql: string;
        operatorSql: "IN" | "NOT IN";
        query: import("./database/query/model-class-query.js").default;
        search: FrontendModelSearch;
    }): boolean;
    /**
     * Runs apply frontend model pagination.
     * @param {object} args - Pagination args.
     * @param {import("./database/query/model-class-query.js").default} args.query - Query instance.
     * @param {FrontendModelPagination} args.pagination - Pagination values.
     * @returns {void}
     */
    applyFrontendModelPagination({ query, pagination }: {
        query: import("./database/query/model-class-query.js").default;
        pagination: FrontendModelPagination;
    }): void;
    /**
     * Runs apply frontend model where.
     * @param {object} args - Where args.
     * @param {import("./database/query/model-class-query.js").default} args.query - Query instance.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.where - Root-model where conditions.
     * @returns {void}
     */
    applyFrontendModelWhere({ query, where }: {
        query: import("./database/query/model-class-query.js").default;
        where: Record<string, ReturnType<typeof JSON.parse>>;
    }): void;
    /**
     * Runs apply frontend model joins.
     * @param {object} args - Joins args.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.joins - Relationship-object joins.
     * @param {import("./database/query/model-class-query.js").default} args.query - Query instance.
     * @returns {void}
     */
    applyFrontendModelJoins({ joins, query }: {
        joins: Record<string, ReturnType<typeof JSON.parse>>;
        query: import("./database/query/model-class-query.js").default;
    }): void;
    /**
     * Runs apply frontend model joins for path.
     * @param {object} args - Joins args.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.joins - Joins for current path.
     * @param {Set<string>} args.joinPathKeys - Joined path keys.
     * @param {typeof import("./database/record/index.js").default} args.modelClass - Model class for current path.
     * @param {string[]} args.path - Relationship path.
     * @param {import("./database/query/model-class-query.js").default} args.query - Query instance.
     * @returns {void}
     */
    applyFrontendModelJoinsForPath({ joins, joinPathKeys, modelClass, path, query }: {
        joins: Record<string, ReturnType<typeof JSON.parse>>;
        joinPathKeys: Set<string>;
        modelClass: typeof import("./database/record/index.js").default;
        path: string[];
        query: import("./database/query/model-class-query.js").default;
    }): void;
    /**
     * Runs frontend model exposed attribute names for model class.
     * @param {typeof import("./database/record/index.js").default} modelClass - Model class.
     * @returns {Set<string> | null} - Exposed attribute names, or null when no resource metadata is available.
     */
    frontendModelExposedAttributeNamesForModelClass(modelClass: typeof import("./database/record/index.js").default): Set<string> | null;
    /**
     * Resolves a frontend-supplied key to its canonical model attribute name.
     * @param {typeof import("./database/record/index.js").default} modelClass - Model class.
     * @param {string} key - Frontend key or raw column key.
     * @returns {string | null} - Canonical attribute name.
     */
    frontendModelAttributeNameForKey(modelClass: typeof import("./database/record/index.js").default, key: string): string | null;
    /**
     * Checks if a frontend-supplied attribute is exposed by the resource.
     * @param {object} args - Args.
     * @param {string} args.attributeName - Requested attribute name.
     * @param {typeof import("./database/record/index.js").default} args.modelClass - Model class.
     * @returns {boolean} - Whether the resource permits the attribute.
     */
    frontendModelAttributeIsExposed({ attributeName, modelClass }: {
        attributeName: string;
        modelClass: typeof import("./database/record/index.js").default;
    }): boolean;
    /**
     * Asserts a selected frontend-model attribute list only references exposed attributes.
     * @param {object} args - Args.
     * @param {string[]} args.attributeNames - Selected attribute names.
     * @param {typeof import("./database/record/index.js").default} args.modelClass - Model class.
     * @param {"select" | "selectsExtra"} args.operationName - Selection operation.
     * @returns {string[]} - Allowed selected attribute names.
     */
    assertFrontendModelSelectedAttributesAllowed({ attributeNames, modelClass, operationName }: {
        attributeNames: string[];
        modelClass: typeof import("./database/record/index.js").default;
        operationName: "select" | "selectsExtra";
    }): string[];
    /**
     * Resolves a user-queryable frontend attribute to a database column.
     * @param {object} args - Args.
     * @param {string} args.attributeName - Requested attribute name.
     * @param {typeof import("./database/record/index.js").default} args.modelClass - Model class.
     * @param {"group" | "pluck" | "search" | "sort" | "where"} args.operationName - Query operation.
     * @returns {string | undefined} - Resolved column name.
     */
    resolveFrontendModelQueryableColumnName({ attributeName, modelClass, operationName }: {
        attributeName: string;
        modelClass: typeof import("./database/record/index.js").default;
        operationName: "group" | "pluck" | "search" | "sort" | "where";
    }): string | undefined;
    /**
     * Resolves a key that may be either a camelCase attribute name or a raw DB
     * column name to its canonical column name.  Returns `undefined` when the
     * key matches neither map.
     * @param {typeof import("./database/record/index.js").default} modelClass - Model class.
     * @param {string} key - Attribute name or column name to resolve.
     * @returns {string | undefined} - Resolved DB column name, or `undefined`.
     */
    resolveFrontendModelColumnName(modelClass: typeof import("./database/record/index.js").default, key: string): string | undefined;
    /**
     * Runs apply frontend model where for path.
     * @param {object} args - Where args.
     * @param {typeof import("./database/record/index.js").default} args.modelClass - Model class for current where scope.
     * @param {string[]} args.path - Relationship path from root.
     * @param {import("./database/query/model-class-query.js").default} args.query - Query instance.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.where - Where conditions for current scope.
     * @returns {void}
     */
    applyFrontendModelWhereForPath({ modelClass, path, query, where }: {
        modelClass: typeof import("./database/record/index.js").default;
        path: string[];
        query: import("./database/query/model-class-query.js").default;
        where: Record<string, ReturnType<typeof JSON.parse>>;
    }): void;
    /**
     * Runs normalize frontend model where column value.
     * @param {object} args - Args.
     * @param {typeof import("./database/record/index.js").default} args.modelClass - Model class.
     * @param {string} args.columnName - Column name.
     * @param {ReturnType<typeof JSON.parse>} args.value - Where value.
     * @returns {ReturnType<typeof JSON.parse> | symbol} - SQL-safe where value.
     */
    normalizeFrontendModelWhereColumnValue({ columnName, modelClass, value }: {
        modelClass: typeof import("./database/record/index.js").default;
        columnName: string;
        value: ReturnType<typeof JSON.parse>;
    }): ReturnType<typeof JSON.parse> | symbol;
    /**
     * Runs apply frontend model group.
     * @param {object} args - Group args.
     * @param {import("./database/query/model-class-query.js").default} args.query - Query instance.
     * @param {FrontendModelGroup} args.group - Group definition.
     * @returns {void}
     */
    applyFrontendModelGroup({ query, group }: {
        query: import("./database/query/model-class-query.js").default;
        group: FrontendModelGroup;
    }): void;
    /**
     * Adds root-model columns to GROUP BY so strict SQL engines accept default root-table selects.
     * @param {object} args - Args.
     * @param {import("./database/query/model-class-query.js").default} args.query - Query instance.
     * @returns {void}
     */
    applyFrontendModelRootGroupColumns({ query }: {
        query: import("./database/query/model-class-query.js").default;
    }): void;
    /**
     * Ensures a group-by SQL column is only appended once.
     * @param {object} args - Args.
     * @param {string} args.columnSql - Fully-qualified column SQL.
     * @param {import("./database/query/model-class-query.js").default} args.query - Query instance.
     * @returns {void}
     */
    ensureFrontendModelGroupColumn({ columnSql, query }: {
        columnSql: string;
        query: import("./database/query/model-class-query.js").default;
    }): void;
    /**
     * Runs apply frontend model translated attribute preloads.
     * @param {object} args - Args.
     * @param {import("./database/query/model-class-query.js").default<typeof import("./database/record/index.js").default>} args.query - Query instance.
     * @returns {import("./database/query/model-class-query.js").default<typeof import("./database/record/index.js").default>} - Query with translations preloaded if needed.
     */
    applyFrontendModelTranslatedAttributePreloads({ query }: {
        query: import("./database/query/model-class-query.js").default<typeof import("./database/record/index.js").default>;
    }): import("./database/query/model-class-query.js").default<typeof import("./database/record/index.js").default>;
    /**
     * Runs apply frontend model sort.
     * @param {object} args - Sort args.
     * @param {import("./database/query/model-class-query.js").default} args.query - Query instance.
     * @param {FrontendModelSort} args.sort - Sort definition.
     * @returns {void}
     */
    applyFrontendModelSort({ query, sort }: {
        query: import("./database/query/model-class-query.js").default;
        sort: FrontendModelSort;
    }): void;
    /**
     * Ensures a sort join path has been joined on query.
     * @param {object} args - Join args.
     * @param {string[]} args.path - Relationship join path.
     * @param {import("./database/query/model-class-query.js").default} args.query - Query instance.
     * @returns {void}
     */
    ensureFrontendModelSortJoinPath({ path, query }: {
        path: string[];
        query: import("./database/query/model-class-query.js").default;
    }): void;
    /**
     * Ensures a relationship path has exactly one SQL join.
     * @param {object} args - Join args.
     * @param {string[]} args.path - Relationship join path.
     * @param {import("./database/query/model-class-query.js").default} args.query - Query instance.
     * @returns {void}
     */
    ensureFrontendModelJoinPath({ path, query }: {
        path: string[];
        query: import("./database/query/model-class-query.js").default;
    }): void;
    /**
     * Runs frontend model selected attributes for model class.
     * @param {typeof import("./database/record/index.js").default} modelClass - Model class.
     * @returns {string[] | null} - Selected attributes for model class.
     */
    frontendModelSelectedAttributesForModelClass(modelClass: typeof import("./database/record/index.js").default): string[] | null;
    /**
     * Runs frontend model selects extra for model class.
     * @param {typeof import("./database/record/index.js").default} modelClass - Model class.
     * @returns {string[] | null} - Extra attributes (loaded in addition to the defaults) for the model class.
     */
    frontendModelSelectsExtraForModelClass(modelClass: typeof import("./database/record/index.js").default): string[] | null;
    /**
     * Resolves the final set of attribute names to serialize for a model class:
     * an explicit narrowing `select` wins; otherwise, when `selectsExtra` is given,
     * the default attributes plus the extras; otherwise null (default behavior).
     * @param {typeof import("./database/record/index.js").default} modelClass - Model class.
     * @param {string[]} fallbackAttributeNames - Attribute names to treat as the defaults when the resource declares none.
     * @returns {string[] | null} - Effective selected attribute names, or null for default serialization.
     */
    frontendModelEffectiveSelectedAttributesForModelClass(modelClass: typeof import("./database/record/index.js").default, fallbackAttributeNames: string[]): string[] | null;
    /**
     * Runs frontend model default attributes for model class.
     * @param {typeof import("./database/record/index.js").default} modelClass - Model class.
     * @returns {string[] | null} - Default frontend-model attributes declared on the resource.
     */
    frontendModelDefaultAttributesForModelClass(modelClass: typeof import("./database/record/index.js").default): string[] | null;
    /**
     * Runs serialize frontend model attributes.
     * @param {import("./database/record/index.js").default} model - Model instance.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} - Serialized attributes filtered by select map.
     */
    serializeFrontendModelAttributes(model: import("./database/record/index.js").default): Promise<Record<string, ReturnType<typeof JSON.parse>>>;
    /**
     * Returns the request-scoped serialization resource instance cache.
     * @returns {Map<typeof import("./database/record/index.js").default, Map<boolean, import("./frontend-model-resource/base-resource.js").default>>} - Cache.
     */
    _frontendModelSerializationResourceInstancesMap(): Map<typeof import("./database/record/index.js").default, Map<boolean, import("./frontend-model-resource/base-resource.js").default>>;
    /**
     * Looks up a cached serialization resource instance.
     * @param {typeof import("./database/record/index.js").default} modelClass - Model class.
     * @param {boolean} isRelated - Whether the resource is for a related (non-root) model.
     * @returns {import("./frontend-model-resource/base-resource.js").default | undefined} - Cached resource or undefined.
     */
    _cachedSerializationResourceInstance(modelClass: typeof import("./database/record/index.js").default, isRelated: boolean): import("./frontend-model-resource/base-resource.js").default | undefined;
    /**
     * Stores a serialization resource instance in the request-scoped cache.
     * @param {typeof import("./database/record/index.js").default} modelClass - Model class.
     * @param {boolean} isRelated - Whether the resource is for a related (non-root) model.
     * @param {import("./frontend-model-resource/base-resource.js").default} resource - Resource instance.
     * @returns {void}
     */
    _setCachedSerializationResourceInstance(modelClass: typeof import("./database/record/index.js").default, isRelated: boolean, resource: import("./frontend-model-resource/base-resource.js").default): void;
    /**
     * Sets a per-instance hook invoked for every serialization resource instance
     * resolution. The hook is scoped to this controller; it never affects other
     * controller instances. Passing `null` clears the hook.
     * @param {FrontendModelSerializationResourceInstanceHook | null} hook - Hook callback or null.
     * @returns {() => void} - Cleanup function that restores the previous hook.
     */
    setSerializationResourceInstanceHook(hook: FrontendModelSerializationResourceInstanceHook | null): () => void;
    /**
     * Runs serialization resource instance for model.
     * @param {import("./database/record/index.js").default} model - Model instance.
     * @returns {import("./frontend-model-resource/base-resource.js").default | null} - Resource instance or null.
     */
    _serializationResourceInstanceForModel(model: import("./database/record/index.js").default): import("./frontend-model-resource/base-resource.js").default | null;
    /**
     * Runs frontend model filter serializable related models.
     * @param {object} args - Arguments.
     * @param {import("./database/record/index.js").default[]} args.models - Frontend model records.
     * @param {boolean} args.relationshipIsCollection - Whether relation is has-many.
     * @returns {Promise<import("./database/record/index.js").default[]>} - Serializable related models.
     */
    frontendModelFilterSerializableRelatedModels({ models, relationshipIsCollection }: {
        models: import("./database/record/index.js").default[];
        relationshipIsCollection: boolean;
    }): Promise<import("./database/record/index.js").default[]>;
    /**
     * Runs is serializable frontend model.
     * @param {ReturnType<typeof JSON.parse>} value - Candidate preloaded value.
     * @returns {value is import("./database/record/index.js").default} - Whether value behaves like a model.
     */
    isSerializableFrontendModel(value: ReturnType<typeof JSON.parse>): value is import("./database/record/index.js").default;
    /**
     * Runs serialize frontend models.
     * @param {import("./database/record/index.js").default[]} models - Models to serialize.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>[]>} - Serialized model payloads.
     */
    serializeFrontendModels(models: import("./database/record/index.js").default[]): Promise<Record<string, ReturnType<typeof JSON.parse>>[]>;
    /**
     * Runs serialize frontend model.
     * @param {import("./database/record/index.js").default} model - Frontend model record.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} - Serialized frontend model payload.
     */
    serializeFrontendModel(model: import("./database/record/index.js").default): Promise<Record<string, ReturnType<typeof JSON.parse>>>;
    /**
     * Runs frontend model render error.
     * @param {string} errorMessage - Error message.
     * @returns {Promise<void>} - Resolves when error has been rendered.
     */
    frontendModelRenderError(errorMessage: string): Promise<void>;
    /**
     * Runs frontend model error payload.
     * @param {string} errorMessage - Error message.
     * @param {object} [options] - Structured error fields.
     * @param {import("./configuration-types.js").ClientErrorPayloadReporterPayload} [options.details] - Client-safe details.
     * @param {"application_error" | "authorization_error" | "internal_error" | "record_not_found" | "validation_error"} [options.errorType] - Stable client-facing error category.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Error payload.
     */
    frontendModelErrorPayload(errorMessage: string, options?: {
        details?: import("./configuration-types.js").ClientErrorPayloadReporterPayload;
        errorType?: "application_error" | "authorization_error" | "internal_error" | "record_not_found" | "validation_error";
    }): Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * Runs frontend model client safe error payload.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Client-safe error payload.
     */
    frontendModelClientSafeErrorPayload(): Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * Builds frontend-model endpoint error context for logging and client payload reporters.
     * @param {object} args - Error context args.
     * @param {string} args.action - Endpoint/action label.
     * @param {unknown} args.error - Caught error.
     * @param {"index" | "find" | "create" | "update" | "destroy" | "attach" | "attachmentList" | "download" | "url" | "custom-command"} [args.commandType] - Frontend-model command type.
     * @param {string | undefined} [args.model] - Request model name when available.
     * @param {string | undefined} [args.requestId] - Batch request id when available.
     * @returns {FrontendModelEndpointErrorContext} Frontend-model endpoint error context.
     */
    frontendModelEndpointErrorContext({ action, commandType, error, model, requestId }: {
        action: string;
        error: unknown;
        commandType?: "index" | "find" | "create" | "update" | "destroy" | "attach" | "attachmentList" | "download" | "url" | "custom-command";
        model?: string | undefined;
        requestId?: string | undefined;
    }): FrontendModelEndpointErrorContext;
    /**
     * Runs frontend model client error payload for error.
     * @param {unknown} error - Caught error.
     * @param {FrontendModelEndpointErrorContext | undefined} [endpointErrorContext] - Frontend-model endpoint error context.
     * @returns {Promise<import("./configuration-types.js").ClientErrorPayloadReporterPayload>} - Client payload for the current environment.
     */
    frontendModelClientErrorPayloadForError(error: unknown, endpointErrorContext?: FrontendModelEndpointErrorContext | undefined): Promise<import("./configuration-types.js").ClientErrorPayloadReporterPayload>;
    /**
     * Runs frontend model log endpoint error.
     * @param {object} args - Error log args.
     * @param {ReturnType<typeof JSON.parse>} args.error - Caught error.
     * @param {FrontendModelEndpointErrorContext} args.errorContext - Shared client/logging error context.
     * @returns {Promise<void>} - Resolves after logging.
     */
    frontendModelLogEndpointError({ error, errorContext }: {
        error: ReturnType<typeof JSON.parse>;
        errorContext: FrontendModelEndpointErrorContext;
    }): Promise<void>;
    /**
     * Runs frontend model render command response.
     * @param {"index" | "find" | "create" | "update" | "destroy" | "attach" | "attachmentList" | "download" | "url"} action - Frontend action.
     * @returns {Promise<void>} - Resolves when response has been rendered.
     */
    frontendModelRenderCommandResponse(action: "index" | "find" | "create" | "update" | "destroy" | "attach" | "attachmentList" | "download" | "url"): Promise<void>;
    /**
     * Runs frontend model command payload.
     * @param {"index" | "find" | "create" | "update" | "destroy" | "attach" | "attachmentList" | "download" | "url"} action - Frontend action.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>> | null>} - Response payload.
     */
    frontendModelCommandPayload(action: "index" | "find" | "create" | "update" | "destroy" | "attach" | "attachmentList" | "download" | "url"): Promise<Record<string, ReturnType<typeof JSON.parse>> | null>;
    /**
     * Runs frontend sync bootstrap.
     * @returns {Promise<void>} - Sync bootstrap response with manifest and signed offline grant.
     */
    frontendSyncBootstrap(): Promise<void>;
    /**
     * Resolves device id for sync bootstrap.
     * @param {Record<string, import("./configuration-types.js").FrontendModelSyncJsonValue | undefined>} params - Request params.
     * @returns {string} - Device id.
     */
    frontendSyncBootstrapDeviceId(params: Record<string, import("./configuration-types.js").FrontendModelSyncJsonValue | undefined>): string;
    /**
     * Resolves grant id for sync bootstrap.
     * @param {Record<string, import("./configuration-types.js").FrontendModelSyncJsonValue | undefined>} params - Request params.
     * @returns {string | undefined} - Deterministic grant id for tests, generated id otherwise.
     */
    frontendSyncBootstrapGrantId(params: Record<string, import("./configuration-types.js").FrontendModelSyncJsonValue | undefined>): string | undefined;
    /**
     * Resolves bootstrap issue time.
     * @param {Record<string, import("./configuration-types.js").FrontendModelSyncJsonValue | undefined>} params - Request params.
     * @returns {Date} - Issue time.
     */
    frontendSyncBootstrapNow(params: Record<string, import("./configuration-types.js").FrontendModelSyncJsonValue | undefined>): Date;
    /**
     * Resolves sync bootstrap scopes.
     * @param {Record<string, import("./configuration-types.js").FrontendModelSyncJsonValue | undefined>} params - Request params.
     * @returns {Record<string, import("./configuration-types.js").FrontendModelSyncJsonValue>} - Grant scopes.
     */
    frontendSyncBootstrapScopes(params: Record<string, import("./configuration-types.js").FrontendModelSyncJsonValue | undefined>): Record<string, import("./configuration-types.js").FrontendModelSyncJsonValue>;
    /**
     * Resolves current user id for sync bootstrap.
     * @returns {string} - User id.
     */
    frontendSyncBootstrapUserId(): string;
    /**
     * Runs frontend sync replay.
     * @returns {Promise<void>} - Sync replay response with per-mutation results.
     */
    frontendSyncReplay(): Promise<void>;
    /**
     * Resolves signed replay mutations from request params.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} params - Request params.
     * @returns {Array<ReturnType<typeof JSON.parse>>} - Signed mutation envelopes.
     */
    frontendSyncReplaySignedMutations(params: Record<string, ReturnType<typeof JSON.parse>>): Array<ReturnType<typeof JSON.parse>>;
    /**
     * Verifies and replays one signed sync mutation.
     * @param {ReturnType<typeof JSON.parse>} signedMutation - Signed mutation envelope.
     * @returns {Promise<{response: Record<string, ReturnType<typeof JSON.parse>>, serverChangeFeedError?: Record<string, ReturnType<typeof JSON.parse>>, serverChangeFeedStatus?: "error", serverSequence: number | null}>} - Frontend-model command response and appended server sequence.
     */
    frontendSyncReplaySignedMutation(signedMutation: ReturnType<typeof JSON.parse>): Promise<{
        response: Record<string, ReturnType<typeof JSON.parse>>;
        serverChangeFeedError?: Record<string, ReturnType<typeof JSON.parse>>;
        serverChangeFeedStatus?: "error";
        serverSequence: number | null;
    }>;
    /**
     * Resolves the signed offline grant carried by a replay request.
     * @param {ReturnType<typeof JSON.parse>} signedMutation - Signed mutation envelope.
     * @returns {ReturnType<typeof JSON.parse>} - Signed offline grant envelope.
     */
    frontendSyncReplaySignedOfflineGrant(signedMutation: ReturnType<typeof JSON.parse>): ReturnType<typeof JSON.parse>;
    /**
     * Verifies a sync replay signed offline grant.
     * @param {object} args - Arguments.
     * @param {ReturnType<typeof JSON.parse>} args.signedOfflineGrant - Signed offline grant envelope.
     * @param {import("./sync/offline-grant.js").OfflineGrantSigningKey[]} args.signingKeys - Available signing keys.
     * @returns {Promise<import("./sync/offline-grant.js").OfflineGrant>} - Verified offline grant.
     */
    frontendSyncReplayVerifiedOfflineGrant({ signedOfflineGrant, signingKeys }: {
        signedOfflineGrant: ReturnType<typeof JSON.parse>;
        signingKeys: import("./sync/offline-grant.js").OfflineGrantSigningKey[];
    }): Promise<import("./sync/offline-grant.js").OfflineGrant>;
    /**
     * Validates that a verified offline grant authorizes a replayed mutation.
     * @param {object} args - Arguments.
     * @param {import("./sync/device-identity.js").SyncMutation} args.mutation - Verified mutation.
     * @param {import("./sync/offline-grant.js").OfflineGrant} args.offlineGrant - Verified grant.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.syncResource - Current sync resource entry.
     * @returns {void} - Throws when unauthorized.
     */
    frontendSyncReplayValidateOfflineGrant({ mutation, offlineGrant, syncResource }: {
        mutation: import("./sync/device-identity.js").SyncMutation;
        offlineGrant: import("./sync/offline-grant.js").OfflineGrant;
        syncResource: Record<string, ReturnType<typeof JSON.parse>>;
    }): void;
    /**
     * Replays a verified custom sync mutation through the resource command API.
     * @param {object} args - Arguments.
     * @param {import("./sync/device-identity.js").SyncMutation} args.mutation - Verified mutation.
     * @param {{commandType: string, methodName?: string, scope?: "collection" | "member"}} args.replayCommand - Resolved replay command metadata.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} - Command response payload.
     */
    frontendSyncReplayCustomCommandPayload({ mutation, replayCommand }: {
        mutation: import("./sync/device-identity.js").SyncMutation;
        replayCommand: {
            commandType: string;
            methodName?: string;
            scope?: "collection" | "member";
        };
    }): Promise<Record<string, ReturnType<typeof JSON.parse>>>;
    /**
     * Builds frontend-model command params for a verified replay mutation.
     * @param {import("./sync/device-identity.js").SyncMutation} mutation - Verified mutation.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} - Frontend-model command params.
     */
    frontendSyncReplayCommandParams(mutation: import("./sync/device-identity.js").SyncMutation): Promise<Record<string, ReturnType<typeof JSON.parse>>>;
    /**
     * Resolves the frontend-model command used for a verified replay mutation.
     * @param {import("./sync/device-identity.js").SyncMutation} mutation - Verified mutation.
     * @returns {{commandType: string, methodName?: string, scope?: "collection" | "member"}} - Command metadata.
     */
    frontendSyncReplayCommandForMutation(mutation: import("./sync/device-identity.js").SyncMutation): {
        commandType: string;
        methodName?: string;
        scope?: "collection" | "member";
    };
    /**
     * Resolves command attributes and primary key from a replay mutation.
     * @param {import("./sync/device-identity.js").SyncMutation} mutation - Verified mutation.
     * @returns {Promise<{attributes: Record<string, ReturnType<typeof JSON.parse>>, primaryKeyValue: string | number | undefined}>} - Command attributes and primary key value.
     */
    frontendSyncReplayCommandAttributes(mutation: import("./sync/device-identity.js").SyncMutation): Promise<{
        attributes: Record<string, ReturnType<typeof JSON.parse>>;
        primaryKeyValue: string | number | undefined;
    }>;
    /**
     * Appends a successfully replayed mutation to the server change feed.
     * @param {object} args - Arguments.
     * @param {string | null} args.idempotencyKey - Mutation idempotency key.
     * @param {import("./sync/device-identity.js").SyncMutation} args.mutation - Verified mutation.
     * @param {import("./sync/offline-grant.js").OfflineGrant} args.offlineGrant - Verified offline grant.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} args.response - Replay command response.
     * @returns {Promise<number | null>} - Assigned server sequence, or null when no change was appended.
     */
    frontendSyncAppendServerChange({ idempotencyKey, mutation, offlineGrant, response }: {
        idempotencyKey: string | null;
        mutation: import("./sync/device-identity.js").SyncMutation;
        offlineGrant: import("./sync/offline-grant.js").OfflineGrant;
        response: Record<string, ReturnType<typeof JSON.parse>>;
    }): Promise<number | null>;
    /**
     * Verifies the signed offline grant used to scope sync read endpoints.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} params - Request params.
     * @returns {Promise<import("./sync/offline-grant.js").OfflineGrant>} - Verified offline grant.
     */
    frontendSyncRequestVerifiedOfflineGrant(params: Record<string, ReturnType<typeof JSON.parse>>): Promise<import("./sync/offline-grant.js").OfflineGrant>;
    /**
     * Runs frontend sync change feed.
     * @returns {Promise<void>} - Sync change-feed response.
     */
    frontendSyncChangeFeed(): Promise<void>;
    /**
     * Resolves sync change-feed cursor.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} params - Request params.
     * @returns {number} - Exclusive lower-bound sequence.
     */
    frontendSyncChangeFeedAfterSequence(params: Record<string, ReturnType<typeof JSON.parse>>): number;
    /**
     * Resolves sync change-feed page limit.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} params - Request params.
     * @returns {number} - Page limit.
     */
    frontendSyncChangeFeedLimit(params: Record<string, ReturnType<typeof JSON.parse>>): number;
    /**
     * Resolves sync change-feed stable high-water mark.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} params - Request params.
     * @param {number} currentServerSequence - Current latest server sequence.
     * @returns {number} - Inclusive upper-bound sequence.
     */
    frontendSyncChangeFeedUpToSequence(params: Record<string, ReturnType<typeof JSON.parse>>, currentServerSequence: number): number;
    /**
     * Runs frontend sync snapshot endpoint.
     * @returns {Promise<void>} - Sync snapshot response.
     */
    frontendSyncSnapshot(): Promise<void>;
    /**
     * Builds a snapshot of sync-enabled frontend model resources at a stable server sequence.
     * @param {object} args - Arguments.
     * @param {number} args.serverSequence - Snapshot sequence.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} [args.scope] - Caller sync scope.
     * @returns {Promise<{resources: Record<string, ReturnType<typeof JSON.parse>>, serverSequence: number}>} - Snapshot payload.
     */
    frontendSyncSnapshotPayload({ scope, serverSequence }: {
        serverSequence: number;
        scope?: Record<string, ReturnType<typeof JSON.parse>>;
    }): Promise<{
        resources: Record<string, ReturnType<typeof JSON.parse>>;
        serverSequence: number;
    }>;
    /**
     * Runs frontend api.
     * @returns {Promise<void>} - Shared frontend model API action with batch support.
     */
    frontendApi(): Promise<void>;
    /**
     * Dispatches a custom frontend-model command through the shared frontend-model API endpoint.
     * @param {object} args - Arguments.
     * @param {string} args.customPath - Custom backend route path.
     * @param {ReturnType<typeof JSON.parse>} args.payload - Request payload.
     * @param {import("./remote-request-context.js").RemoteRequestContext} args.requestContext - Captured remote request context.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} - Parsed JSON response payload.
     */
    frontendApiCustomCommandPayload({ customPath, payload, requestContext }: {
        customPath: string;
        payload: ReturnType<typeof JSON.parse>;
        requestContext: import("./remote-request-context.js").RemoteRequestContext;
    }): Promise<Record<string, ReturnType<typeof JSON.parse>>>;
    /**
     * Runs frontend index.
     * @returns {Promise<void>} - Collection action for frontend model resources.
     */
    frontendIndex(): Promise<void>;
    /**
     * Runs frontend find.
     * @returns {Promise<void>} - Member find action for frontend model resources.
     */
    frontendFind(): Promise<void>;
    /**
     * Runs frontend update.
     * @returns {Promise<void>} - Member update action for frontend model resources.
     */
    frontendUpdate(): Promise<void>;
    /**
     * Runs frontend attach.
     * @returns {Promise<void>} - Member attach action for frontend model resources.
     */
    frontendAttach(): Promise<void>;
    /**
     * Runs frontend download.
     * @returns {Promise<void>} - Member download action for frontend model resources.
     */
    frontendDownload(): Promise<void>;
    /**
     * Runs frontend url.
     * @returns {Promise<void>} - Member URL action for frontend model resources.
     */
    frontendUrl(): Promise<void>;
    /**
     * Runs frontend create.
     * @returns {Promise<void>} - Member create action for frontend model resources.
     */
    frontendCreate(): Promise<void>;
    /**
     * Runs frontend destroy.
     * @returns {Promise<void>} - Member destroy action for frontend model resources.
     */
    frontendDestroy(): Promise<void>;
    /**
     * Runs frontend custom command.
     * @returns {Promise<void>} - Custom collection/member command action for frontend-model resources.
     */
    frontendCustomCommand(): Promise<void>;
    /**
     * Runs frontend model custom command payload.
     * @returns {Promise<Record<string, ReturnType<typeof JSON.parse>>>} - Response payload.
     */
    frontendModelCustomCommandPayload(): Promise<Record<string, ReturnType<typeof JSON.parse>>>;
    /**
     * Resolves the typed argument object passed to a custom command method. On the
     * shared-endpoint path the original client payload was captured before route
     * framework params were merged, so it is returned verbatim (a client `id` survives
     * a member route). On the direct path it falls back to the request params with the
     * framework keys the command route hook injected stripped out.
     * @param {Record<string, ReturnType<typeof JSON.parse>>} params - Deserialized frontend-model params.
     * @returns {Record<string, ReturnType<typeof JSON.parse>>} - Client command arguments.
     */
    frontendModelCustomCommandArguments(params: Record<string, ReturnType<typeof JSON.parse>>): Record<string, ReturnType<typeof JSON.parse>>;
    /**
     * Walks a custom-command response payload and replaces any backend `Record`
     * instance with the resource's per-action serialized form so handlers can
     * return `{record, status: "ok"}` instead of explicitly calling
     * `await this.serialize(record, action)`. Plain objects, arrays, and
     * primitive values pass through and are later encoded by
     * `serializeFrontendModelTransportValue`.
     * @param {ReturnType<typeof JSON.parse>} value - Payload value.
     * @param {{serialize: (model: ReturnType<typeof JSON.parse>, action: string) => Promise<Record<string, ReturnType<typeof JSON.parse>>>}} resource - Resource instance providing `serialize`.
     * @param {string} action - Custom command method name passed to `resource.serialize` for per-action authorization filtering.
     * @param {WeakSet<object>} [seen] - Recursion stack of plain-object containers currently being walked. Membership is added on entry and removed on exit so a container shared between siblings (i.e. referenced twice but not cyclically) is walked on each reference instead of being short-circuited the second time, which would let backend `Record` instances inside it bypass `resource.serialize`.
     * @returns {Promise<ReturnType<typeof JSON.parse>>} - Payload with backend `Record` instances replaced by serialized markers.
     */
    autoSerializeFrontendModelsInPayload(value: ReturnType<typeof JSON.parse>, resource: {
        serialize: (model: ReturnType<typeof JSON.parse>, action: string) => Promise<Record<string, ReturnType<typeof JSON.parse>>>;
    }, action: string, seen?: WeakSet<object>): Promise<ReturnType<typeof JSON.parse>>;
}
//# sourceMappingURL=frontend-model-controller.d.ts.map