import { Injectable, Logger } from '@nestjs/common';
import { CreateBucketCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createHash } from 'crypto';
import { extname } from 'path';

@Injectable()
export class ComplianceUploadsService {
  private readonly client: S3Client;
  private readonly bucket: string;
  private bucketReady = false;
  private bucketPromise: Promise<void> | null = null;
  private readonly logger = new Logger(ComplianceUploadsService.name);

  constructor() {
    const endpoint = process.env.COMPLIANCE_S3_ENDPOINT || process.env.S3_ENDPOINT || 'http://localhost:9000';
    const region = process.env.COMPLIANCE_S3_REGION || process.env.S3_REGION || 'us-east-1';
    const accessKeyId = process.env.COMPLIANCE_S3_ACCESS_KEY || process.env.S3_ACCESS_KEY || 'minioadmin';
    const secretAccessKey = process.env.COMPLIANCE_S3_SECRET_KEY || process.env.S3_SECRET_KEY || 'minioadmin';
    this.bucket = process.env.COMPLIANCE_S3_BUCKET || 'wikid-compliance';
    this.client = new S3Client({
      region,
      endpoint,
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  private async ensureBucket() {
    if (this.bucketReady) return;
    if (this.bucketPromise) return this.bucketPromise;
    this.bucketPromise = (async () => {
      try {
        await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      } catch (err) {
        try {
          await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
        } catch (createErr) {
          this.logger.error('Failed to create compliance bucket', createErr as Error);
          // Let the next call retry instead of reusing this failure
          this.bucketPromise = null;
          throw createErr;
        }
      }
      this.bucketReady = true;
      this.bucketPromise = null;
    })();
    return this.bucketPromise;
  }

  private resolveExtension(originalName?: string, contentType?: string) {
    const rawExt = extname(originalName || '');
    if (rawExt) return rawExt;
    if (contentType && contentType.includes('/')) {
      const ext = contentType.split('/')[1];
      if (ext) return `.${ext}`;
    }
    return '';
  }

  private buildObjectKey(hash: string, originalName?: string, contentType?: string) {
    const ext = this.resolveExtension(originalName, contentType);
    return `attachments/${hash}${ext}`;
  }

  private async streamToBuffer(stream: NodeJS.ReadableStream) {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async uploadAttachment(payload: { buffer: Buffer; contentType?: string; originalName?: string }) {
    await this.ensureBucket();
    const hash = createHash('sha256').update(payload.buffer).digest('hex');
    const key = this.buildObjectKey(hash, payload.originalName, payload.contentType);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: payload.buffer,
        ContentType: payload.contentType || 'application/octet-stream',
      })
    );
    return {
      hash,
      storageKey: key,
      size: payload.buffer.length,
      mimeType: payload.contentType || 'application/octet-stream',
      originalName: payload.originalName || 'attachment',
    };
  }

  async getObjectAndVerify(payload: { key: string; expectedHash: string }) {
    await this.ensureBucket();
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: payload.key }));
    const body = result.Body as unknown as NodeJS.ReadableStream;
    const buffer = await this.streamToBuffer(body);
    const hash = createHash('sha256').update(buffer).digest('hex');
    if (hash !== payload.expectedHash) {
      throw new Error('Attachment hash mismatch');
    }
    return { buffer, contentType: result.ContentType || 'application/octet-stream' };
  }
}
