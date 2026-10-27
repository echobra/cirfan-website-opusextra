// api/_lib/storage.ts
// Cloudflare R2 (S3 compatible). The bucket stays private: browsers only ever get short-lived signed URLs.
import { createReadStream, createWriteStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

let s3: S3Client | null = null;

const bucket = () => {
  const name = process.env.R2_BUCKET;
  if (!name) throw new Error('R2_BUCKET is missing');
  return name;
};

const client = () => {
  if (s3) return s3;
  const account = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!account || !accessKeyId || !secretAccessKey) throw new Error('R2 credentials are missing');
  const jurisdiction = process.env.R2_JURISDICTION ? `.${process.env.R2_JURISDICTION}` : '';
  s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${account}${jurisdiction}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
    // Path-style URLs (account.r2.cloudflarestorage.com/bucket/key) keep CSP and CORS rules simple.
    forcePathStyle: true,
    // R2 does not need the SDK's default checksums, and they break browser uploads to signed URLs.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  return s3;
};

/** ASCII-only, safe in a Content-Disposition header. */
export const safeFileName = (name: string) => {
  const cleaned = name.normalize('NFKD').replace(/[^\w.\- ]+/g, '').replace(/\s+/g, ' ').trim();
  return (cleaned || 'file').slice(0, 120);
};

export const signedUpload = (key: string, contentType: string) =>
  getSignedUrl(client(), new PutObjectCommand({ Bucket: bucket(), Key: key, ContentType: contentType }), { expiresIn: 600 });

export const signedDownload = (key: string, fileName: string, seconds = 300) =>
  getSignedUrl(
    client(),
    new GetObjectCommand({
      Bucket: bucket(),
      Key: key,
      ResponseContentDisposition: `attachment; filename="${safeFileName(fileName)}"`,
    }),
    { expiresIn: seconds },
  );

export const signedPreview = (key: string, seconds = 3600) =>
  getSignedUrl(client(), new GetObjectCommand({ Bucket: bucket(), Key: key }), { expiresIn: seconds });

export const downloadToFile = async (key: string, path: string) => {
  const res = await client().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
  if (!res.Body) throw new Error('Empty object');
  await pipeline(res.Body as Readable, createWriteStream(path));
};

export const uploadFromFile = async (key: string, path: string, contentType: string) => {
  const { size } = await stat(path);
  await client().send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: createReadStream(path),
      ContentLength: size,
      ContentType: contentType,
      // No custom x-amz-meta headers: nothing about the source file travels with it.
    }),
  );
  return size;
};

export const removeObject = (key: string) => client().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));

export const removePrefix = async (prefix: string) => {
  let token: string | undefined;
  do {
    const list = await client().send(
      new ListObjectsV2Command({ Bucket: bucket(), Prefix: prefix, ContinuationToken: token }),
    );
    const keys = (list.Contents ?? []).map((o) => ({ Key: o.Key! }));
    if (keys.length) await client().send(new DeleteObjectsCommand({ Bucket: bucket(), Delete: { Objects: keys } }));
    token = list.IsTruncated ? list.NextContinuationToken : undefined;
  } while (token);
};
