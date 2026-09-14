import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { config } from '../config.js';

const PREFIX = 'v1:';
const IV_LEN = 12;
const TAG_LEN = 16;

function keyBytes(): Buffer {
  const key = Buffer.from(config.LLM_KEY_ENCRYPTION_KEY, 'hex');
  if (key.length !== 32) {
    throw new Error('LLM_KEY_ENCRYPTION_KEY must decode to 32 bytes');
  }
  return key;
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', keyBytes(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${Buffer.concat([iv, tag, enc]).toString('base64url')}`;
}

export function decryptSecret(stored: string): string | null {
  if (!stored.startsWith(PREFIX)) return null;
  try {
    const raw = Buffer.from(stored.slice(PREFIX.length), 'base64url');
    if (raw.length <= IV_LEN + TAG_LEN) return null;
    const iv = raw.subarray(0, IV_LEN);
    const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const enc = raw.subarray(IV_LEN + TAG_LEN);
    const decipher = createDecipheriv('aes-256-gcm', keyBytes(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** Public preview: first 6 characters + ****. Never the full key. */
export function maskApiKey(plain: string): string {
  return `${plain.slice(0, 6)}****`;
}
