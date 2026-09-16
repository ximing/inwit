import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';
import S3rver from 's3rver';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadEnv({ path: path.join(serverRoot, '.env') });

const require = createRequire(import.meta.url);
const AWSAccount = require('s3rver/lib/models/account.js');
const accessKey = process.env.S3_ACCESS_KEY ?? 'inwit';
const secretKey = process.env.S3_SECRET_KEY ?? 'inwit';
AWSAccount.DUMMY_ACCOUNT.createKeyPair(accessKey, secretKey);

const PORT = Number(process.env.S3RVER_PORT ?? 4569);
const ADDRESS = process.env.S3RVER_ADDRESS ?? '127.0.0.1';
const BUCKET = process.env.S3_BUCKET ?? 'inwit-dev';
const directory = path.resolve(serverRoot, process.env.S3RVER_DIR ?? '.tmp/s3');
fs.mkdirSync(directory, { recursive: true });

const corsXml = `<?xml version="1.0" encoding="UTF-8"?>
<CORSConfiguration>
  <CORSRule>
    <AllowedOrigin>*</AllowedOrigin>
    <AllowedMethod>GET</AllowedMethod>
    <AllowedMethod>PUT</AllowedMethod>
    <AllowedMethod>HEAD</AllowedMethod>
    <AllowedHeader>*</AllowedHeader>
    <ExposeHeader>ETag</ExposeHeader>
    <MaxAgeSeconds>3000</MaxAgeSeconds>
  </CORSRule>
</CORSConfiguration>
`;

const instance = new S3rver({
  port: PORT,
  address: ADDRESS,
  directory,
  silent: false,
  vhostBuckets: false,
  allowMismatchedSignatures: true,
  configureBuckets: [
    {
      name: BUCKET,
      configs: [corsXml],
    },
  ],
});

const { address, port } = await instance.run();
console.log(`s3rver listening at http://${address}:${port} (bucket ${BUCKET}, path-style)`);
