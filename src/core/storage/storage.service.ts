import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../config/env.js';

export interface StorageUploadOptions {
  bucket?: string;
  key: string;
  body: Buffer | Uint8Array | string;
  contentType: string;
}

export class S3StorageService {
  private readonly client: S3Client;
  private readonly defaultBucket: string;
  private readonly endpoint: string;

  constructor() {
    this.defaultBucket = env.AWS_S3_BUCKET;
    this.endpoint = env.AWS_ENDPOINT_URL_S3;

    this.client = new S3Client({
      endpoint: this.endpoint,
      region: env.AWS_REGION,
      credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY
      },
      forcePathStyle: true // Standard for Neon S3-compatible endpoints
    });
  }

  /**
   * Resolves the public URL for an uploaded key in a given bucket.
   */
  public getPublicUrl(bucket: string = this.defaultBucket, key: string): string {
    const cleanKey = key.replace(/^\/+/, '');
    const cleanBase = this.endpoint.replace(/\/+$/, '');
    return `${cleanBase}/${bucket}/${cleanKey}`;
  }

  /**
   * Generates a temporary pre-signed URL to view/download an object.
   */
  public async getSignedViewUrl(
    bucket: string = this.defaultBucket,
    key: string = '',
    expiresInSeconds: number = 3600
  ): Promise<string> {
    const cleanKey = key.replace(/^\/+/, '');
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: cleanKey
    });

    return await getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }

  /**
   * Uploads a file buffer or string directly to Neon Object Storage.
   * Returns the accessible public URL of the uploaded asset.
   */
  public async uploadFile(options: StorageUploadOptions): Promise<string> {
    const bucket = options.bucket || this.defaultBucket;
    const cleanKey = options.key.replace(/^\/+/, '');

    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: cleanKey,
      Body: options.body,
      ContentType: options.contentType
    });

    await this.client.send(command);
    return this.getPublicUrl(bucket, cleanKey);
  }
}

export const storageService = new S3StorageService();
export default storageService;
