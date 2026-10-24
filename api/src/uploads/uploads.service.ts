import { Injectable, Logger } from '@nestjs/common';
import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  ListObjectsV2CommandOutput,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import { extname } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeEditorContent } from '../pages/editor-doc.util';
import { extractPageIdFromDocName } from '../utils/collab-doc-name.util';

@Injectable()
export class UploadsService {
  private readonly client: S3Client;
  private readonly bucket: string;
  private bucketReady = false;
  private bucketPromise: Promise<void> | null = null;
  private readonly logger = new Logger(UploadsService.name);

  constructor(private readonly prisma: PrismaService) {
    const endpoint = process.env.S3_ENDPOINT || 'http://localhost:9000';
    const region = process.env.S3_REGION || 'us-east-1';
    const accessKeyId = process.env.S3_ACCESS_KEY || 'minioadmin';
    const secretAccessKey = process.env.S3_SECRET_KEY || 'minioadmin';
    this.bucket = process.env.S3_BUCKET || 'wikid';
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
          this.logger.error('Failed to create bucket', createErr as Error);
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

  private isDocStale(doc: { updatedAt: Date; materializedAt: Date | null; materializeRequestedAt: Date | null }) {
    const { updatedAt, materializedAt, materializeRequestedAt } = doc;
    if (materializeRequestedAt && (!materializedAt || materializeRequestedAt > materializedAt)) return true;
    if (!materializedAt) return true;
    if (updatedAt > materializedAt) return true;
    return false;
  }

  buildObjectKey(pageId: string, originalName?: string, contentType?: string) {
    const ext = this.resolveExtension(originalName, contentType);
    const filename = `${Date.now()}-${randomUUID()}${ext}`;
    return `${pageId}/${filename}`;
  }

  async uploadImage(payload: { pageId: string; buffer: Buffer; contentType?: string; originalName?: string }) {
    await this.ensureBucket();
    const key = this.buildObjectKey(payload.pageId, payload.originalName, payload.contentType);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: payload.buffer,
        ContentType: payload.contentType || 'application/octet-stream',
      })
    );
    return { key };
  }

  async getObject(key: string) {
    await this.ensureBucket();
    return this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  private extractUploadKey(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const hasUploads = trimmed.includes('/uploads/') || trimmed.startsWith('uploads/');
    if (!hasUploads) return null;
    try {
      const url = new URL(trimmed, 'http://localhost');
      const marker = '/uploads/';
      const idx = url.pathname.indexOf(marker);
      if (idx < 0) return null;
      const key = url.pathname.slice(idx + marker.length);
      return key || null;
    } catch {
      return null;
    }
  }

  private collectUploadKeysFromValue(value: unknown, keys: Set<string>) {
    if (typeof value === 'string') {
      const key = this.extractUploadKey(value);
      if (key) keys.add(key);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry) => this.collectUploadKeysFromValue(entry, keys));
      return;
    }
    if (!value || typeof value !== 'object') return;
    Object.values(value as Record<string, unknown>).forEach((entry) => {
      this.collectUploadKeysFromValue(entry, keys);
    });
  }

  private async collectReferencedUploadKeys() {
    const pages = await this.prisma.page.findMany({ select: { content: true } });
    const keys = new Set<string>();
    pages.forEach((page) => {
      if (!page?.content) return;
      const normalized = normalizeEditorContent(page.content);
      this.collectUploadKeysFromValue(normalized, keys);
    });
    return keys;
  }

  private async collectStalePageIds() {
    const docs = await this.prisma.collabDoc.findMany({
      select: {
        documentName: true,
        updatedAt: true,
        materializedAt: true,
        materializeRequestedAt: true,
      },
    });
    const stale = new Set<string>();
    docs.forEach((doc) => {
      const pageId = extractPageIdFromDocName(doc.documentName);
      if (!pageId) return;
      if (this.isDocStale(doc)) {
        stale.add(pageId);
      }
    });
    return stale;
  }

  private async listAllObjectKeys() {
    await this.ensureBucket();
    const keys: string[] = [];
    let token: string | undefined = undefined;
    do {
      const result: ListObjectsV2CommandOutput = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.bucket, ContinuationToken: token })
      );
      if (Array.isArray(result.Contents)) {
        result.Contents.forEach((entry) => {
          if (entry.Key) keys.push(entry.Key);
        });
      }
      token = result.IsTruncated ? result.NextContinuationToken : undefined;
    } while (token);
    return keys;
  }

  private isPageUploadKey(key: string) {
    const [prefix] = key.split('/');
    return /^[0-9a-fA-F-]{36}$/.test(prefix || '');
  }

  private async deleteObjectKeys(keys: string[]) {
    await this.ensureBucket();
    if (!keys.length) return { deleted: 0, errors: [] as { key: string; code?: string; message?: string }[] };
    const errors: { key: string; code?: string; message?: string }[] = [];
    let deleted = 0;
    for (let i = 0; i < keys.length; i += 1000) {
      const batch = keys.slice(i, i + 1000);
      const result = await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: batch.map((key) => ({ Key: key })) },
        })
      );
      if (Array.isArray(result.Deleted)) {
        deleted += result.Deleted.length;
      }
      if (Array.isArray(result.Errors)) {
        result.Errors.forEach((err) => {
          if (!err?.Key) return;
          errors.push({ key: err.Key, code: err.Code, message: err.Message });
        });
      }
    }
    return { deleted, errors };
  }

  async garbageCollectUploads() {
    const referencedKeys = await this.collectReferencedUploadKeys();
    const [allKeys, stalePageIds] = await Promise.all([this.listAllObjectKeys(), this.collectStalePageIds()]);
    const candidateKeys = allKeys.filter((key) => this.isPageUploadKey(key));
    const skippedKeys = candidateKeys.filter((key) => stalePageIds.has(key.split('/')[0]));
    const eligibleKeys = candidateKeys.filter((key) => !stalePageIds.has(key.split('/')[0]));
    const orphanedKeys = eligibleKeys.filter((key) => !referencedKeys.has(key));
    const { deleted, errors } = await this.deleteObjectKeys(orphanedKeys);
    return {
      totalObjects: allKeys.length,
      candidateObjects: candidateKeys.length,
      eligibleObjects: eligibleKeys.length,
      skippedObjects: skippedKeys.length,
      stalePageCount: stalePageIds.size,
      referencedObjects: referencedKeys.size,
      orphanedObjects: orphanedKeys.length,
      deletedObjects: deleted,
      ignoredObjects: allKeys.length - candidateKeys.length,
      errorCount: errors.length,
      errors: errors.slice(0, 10),
    };
  }
}
