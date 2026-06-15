// @ts-check

/**
 * Runs throw s3 configuration error.
 * @param {string} message - Error message.
 * @returns {never} - Always throws.
 */
function throwS3ConfigurationError(message) {
  throw new Error(`Invalid S3 attachment storage configuration: ${message}`)
}

/**
 * Runs is readable stream.
 * @param {?} value - Candidate value.
 * @returns {boolean} - Whether value is a readable stream.
 */
function isReadableStream(value) {
  return Boolean(value && typeof value === "object" && typeof /**
                                                               * Narrows the runtime value to the documented type.
                                                               * @type {?} */ (value).pipe === "function")
}

/**
 * Runs dynamic import.
 * @param {string} specifier - Module specifier.
 * @returns {Promise<?>} - Imported module.
 */
async function dynamicImport(specifier) {
  const importer = /**
                    * Narrows the runtime value to the documented type.
                    * @type {(moduleSpecifier: string) => Promise<?>} */ (
    new Function("moduleSpecifier", "return import(moduleSpecifier)")
  )

  return await importer(specifier)
}

/**
 * Runs stream to buffer.
 * @param {?} value - Candidate value.
 * @returns {Promise<Buffer>} - Buffer value.
 */
async function streamToBuffer(value) {
  if (Buffer.isBuffer(value)) return value
  if (value instanceof Uint8Array) return Buffer.from(value)
  if (value instanceof ArrayBuffer) return Buffer.from(value)

  if (!isReadableStream(value)) {
    throw new Error(`Unsupported S3 body type: ${String(value)}`)
  }

  /**
   * Chunks.
   * @type {Buffer[]} */
  const chunks = []

  const readableStream = /**
                          * Narrows the runtime value to the documented type.
                          * @type {?} */ (value)

  await new Promise((resolve, reject) => {
    readableStream.on("data", (/**
                                * Narrows the runtime value to the documented type.
                                * @type {Buffer | Uint8Array | ArrayBuffer | string} */ chunk) => {
      if (Buffer.isBuffer(chunk)) {
        chunks.push(chunk)
      } else if (chunk instanceof ArrayBuffer) {
        chunks.push(Buffer.from(chunk))
      } else {
        chunks.push(Buffer.from(chunk))
      }
    })
    readableStream.on("error", reject)
    readableStream.on("end", resolve)
  })

  return Buffer.concat(chunks)
}

/**
 * S3 attachment storage driver.
 */
export default class S3AttachmentStorageDriver {
  /**
   * Runs constructor.
   * @param {object} args - Options.
   * @param {Record<string, ?>} [args.options] - Driver options.
   */
  constructor({options = {}}) {
    this.options = options
    this._clientPromise = null
  }

  /**
   * Runs bucket.
   * @returns {string} - S3 bucket name.
   */
  bucket() {
    const value = this.options.bucket || process.env.VELOCIOUS_ATTACHMENTS_S3_BUCKET

    if (typeof value !== "string" || value.length < 1) {
      throwS3ConfigurationError("missing bucket")
    }

    return value
  }

  /**
   * Runs signed url expires in.
   * @returns {number} - Signed URL expiration in seconds.
   */
  signedUrlExpiresIn() {
    const value = Number(this.options.signedUrlExpiresIn ?? process.env.VELOCIOUS_ATTACHMENTS_S3_SIGNED_URL_EXPIRES_IN ?? 3600)

    if (!Number.isFinite(value) || value < 1) return 3600

    return Math.floor(value)
  }

  /**
   * Runs s3 runtime.
   * @returns {Promise<{S3Client: ?, PutObjectCommand: ?, GetObjectCommand: ?, DeleteObjectCommand: ?, getSignedUrl: ?}>} - S3 runtime.
   */
  async s3Runtime() {
    if (!this._clientPromise) {
      this._clientPromise = (async () => {
        const [{S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand}, {getSignedUrl}] = await Promise.all([
          dynamicImport("@aws-sdk/client-s3"),
          dynamicImport("@aws-sdk/s3-request-presigner")
        ])

        return {DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client, getSignedUrl}
      })()
    }

    return await this._clientPromise
  }

  /**
   * Runs client.
   * @returns {Promise<?>} - S3 client.
   */
  async client() {
    if (!this._client) {
      const {S3Client} = await this.s3Runtime()
      /**
       * Client config.
       * @type {Record<string, ?>} */
      const clientConfig = {
        region: this.options.region || process.env.VELOCIOUS_ATTACHMENTS_S3_REGION || "us-east-1"
      }

      if (typeof this.options.endpoint === "string" && this.options.endpoint.length > 0) {
        clientConfig.endpoint = this.options.endpoint
      }

      if (typeof this.options.forcePathStyle === "boolean") {
        clientConfig.forcePathStyle = this.options.forcePathStyle
      }

      const accessKeyId = this.options.accessKeyId || process.env.VELOCIOUS_ATTACHMENTS_S3_ACCESS_KEY_ID
      const secretAccessKey = this.options.secretAccessKey || process.env.VELOCIOUS_ATTACHMENTS_S3_SECRET_ACCESS_KEY

      if (typeof accessKeyId === "string" && accessKeyId.length > 0 && typeof secretAccessKey === "string" && secretAccessKey.length > 0) {
        clientConfig.credentials = {accessKeyId, secretAccessKey}
      }

      this._client = new S3Client(clientConfig)
    }

    return this._client
  }

  /**
   * Runs write.
   * @param {object} args - Write args.
   * @param {string} args.attachmentId - Attachment id.
   * @param {{contentBuffer: Buffer, contentType: string | null, filename: string}} args.input - Normalized attachment input.
   * @returns {Promise<{storageKey: string}>} - Storage key.
   */
  async write({attachmentId, input}) {
    const {PutObjectCommand} = await this.s3Runtime()
    const client = await this.client()
    const storageKey = `${attachmentId}-${input.filename}`

    await client.send(new PutObjectCommand({
      Body: input.contentBuffer,
      Bucket: this.bucket(),
      ContentType: input.contentType || undefined,
      Key: storageKey
    }))

    return {storageKey}
  }

  /**
   * Runs read.
   * @param {object} args - Read args.
   * @param {string} args.storageKey - Storage key.
   * @returns {Promise<Buffer>} - Attachment bytes.
   */
  async read({storageKey}) {
    const {GetObjectCommand} = await this.s3Runtime()
    const client = await this.client()
    const response = await client.send(new GetObjectCommand({
      Bucket: this.bucket(),
      Key: storageKey
    }))

    return await streamToBuffer(response.Body)
  }

  /**
   * Runs delete.
   * @param {object} args - Delete args.
   * @param {string} args.storageKey - Storage key.
   * @returns {Promise<void>} - Resolves when deleted.
   */
  async delete({storageKey}) {
    const {DeleteObjectCommand} = await this.s3Runtime()
    const client = await this.client()

    await client.send(new DeleteObjectCommand({
      Bucket: this.bucket(),
      Key: storageKey
    }))
  }

  /**
   * Runs url.
   * @param {object} args - URL args.
   * @param {string} args.storageKey - Storage key.
   * @returns {Promise<string>} - Signed URL.
   */
  async url({storageKey}) {
    const runtime = await this.s3Runtime()
    const client = await this.client()
    const command = new runtime.GetObjectCommand({
      Bucket: this.bucket(),
      Key: storageKey
    })

    return await runtime.getSignedUrl(client, command, {expiresIn: this.signedUrlExpiresIn()})
  }
}
