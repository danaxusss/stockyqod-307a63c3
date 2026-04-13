import { pbkdf2Sync, randomBytes, timingSafeEqual } from 'crypto';

const ITERATIONS = 100000;
const KEY_LENGTH = 32;

export function hashPin(pin: string): string {
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(pin, salt, ITERATIONS, KEY_LENGTH, 'sha256');
  return `pbkdf2:${ITERATIONS}:${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPin(pin: string, stored: string): boolean {
  if (stored.startsWith('pbkdf2:')) {
    const parts = stored.split(':');
    if (parts.length !== 4) return false;
    const [, iterStr, saltHex, hashHex] = parts;
    const iterations = parseInt(iterStr, 10);
    const salt = Buffer.from(saltHex, 'hex');
    const hash = pbkdf2Sync(pin, salt, iterations, KEY_LENGTH, 'sha256');
    try {
      return timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
    } catch {
      return false;
    }
  }
  // Legacy plaintext fallback
  return stored === pin;
}
