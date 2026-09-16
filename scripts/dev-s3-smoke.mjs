/**
 * Smoke: s3rver + presign PUT/GET round-trip.
 * Run from repo root: node scripts/dev-s3-smoke.mjs
 * Starts s3rver on :4569 if nothing is listening, then leaves it running.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverPkg = path.join(root, 'apps/server/package.json');
const require = createRequire(serverPkg);

const { S3Client, CreateBucketCommand, HeadBucketCommand, PutObjectCommand, GetObjectCommand } =
  require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const S3rver = require('s3rver');
const AWSAccount = require('s3rver/lib/models/account.js');
AWSAccount.DUMMY_ACCOUNT.createKeyPair(process.env.S3_ACCESS_KEY ?? 'inwit', process.env.S3_SECRET_KEY ?? 'inwit');

const PORT = Number(process.env.S3RVER_PORT ?? 4569);
const ADDRESS = process.env.S3RVER_ADDRESS ?? '127.0.0.1';
const BUCKET = process.env.S3_BUCKET ?? 'inwit-dev';
const REGION = process.env.S3_REGION ?? 'us-east-1';
const ENDPOINT = process.env.S3_ENDPOINT ?? `http://${ADDRESS}:${PORT}`;
const ACCESS_KEY = process.env.S3_ACCESS_KEY ?? 'inwit';
const SECRET_KEY = process.env.S3_SECRET_KEY ?? 'inwit';
const directory = path.join(root, 'apps/server/.tmp/s3');

function portOpen(port, host) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host }, () => {
      socket.end();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
  });
}

async function ensureS3rver() {
  if (await portOpen(PORT, ADDRESS)) {
    console.log(`s3rver already listening on ${ADDRESS}:${PORT}`);
    return { started: false, instance: null };
  }
  fs.mkdirSync(directory, { recursive: true });
  const instance = new S3rver({
    port: PORT,
    address: ADDRESS,
    directory,
    silent: true,
    vhostBuckets: false,
    allowMismatchedSignatures: true,
    configureBuckets: [{ name: BUCKET }],
  });
  await instance.run();
  console.log(`s3rver started at http://${ADDRESS}:${PORT} (bucket ${BUCKET})`);
  return { started: true, instance };
}

function client() {
  return new S3Client({
    region: REGION,
    endpoint: ENDPOINT,
    forcePathStyle: true,
    credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

async function ensureBucket(s3) {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: BUCKET }));
  } catch {
    await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
  }
}

async function main() {
  const { started } = await ensureS3rver();
  const s3 = client();
  await ensureBucket(s3);

  const key = `smoke/${Date.now()}.txt`;
  const body = `inwit-s3-smoke ${new Date().toISOString()}\n`;
  const contentType = 'text/plain';

  const uploadUrl = await getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType }),
    { expiresIn: 900 },
  );
  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body,
  });
  if (!putRes.ok) {
    throw new Error(`presign PUT failed: ${putRes.status} ${await putRes.text()}`);
  }

  const getUrl = await getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: BUCKET, Key: key }),
    { expiresIn: 3600 },
  );
  const getRes = await fetch(getUrl);
  if (!getRes.ok) {
    throw new Error(`presign GET failed: ${getRes.status} ${await getRes.text()}`);
  }
  const got = await getRes.text();
  if (got !== body) {
    throw new Error(`content mismatch: sent ${JSON.stringify(body)} got ${JSON.stringify(got)}`);
  }

  console.log('PASS  presignPut → PUT → presignGet → GET round-trip');
  console.log(`      key=${key}`);
  if (started) {
    console.log('s3rver kept running on port 4569');
    // Keep the process alive so the server we started stays up.
    await new Promise(() => {});
  }
}

try {
  await main();
} catch (err) {
  console.error('FAIL', err);
  process.exitCode = 1;
}
