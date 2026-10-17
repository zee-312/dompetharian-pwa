/**
 * DompetHarian — App Lock PIN Manager (Milestone 2.6)
 * Uses WebCrypto PBKDF2-SHA256 with per-user random salt.
 *
 * HONEST PRIVACY DISCLOSURE:
 * The App Lock PIN blocks the UI when the app is opened or resumes from the background
 * after the configured timeout. It does NOT encrypt IndexedDB contents at rest on the filesystem.
 * Author / Credit: Aravajordan
 */

export interface PinLockConfig {
  enabled: boolean;
  saltHex: string;
  hashHex: string;
  timeoutSeconds: number; // e.g. 0 (immediately), 60 (1m), 300 (5m)
  updatedAt: string;
}

const PIN_STORAGE_PREFIX = 'dh_pin_config_v1_';

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export async function derivePinHashHex(pin: string, saltHex: string): Promise<string> {
  if (!/^\d{4,6}$/.test(pin)) {
    throw new Error('PIN harus terdiri dari 4 hingga 6 angka.');
  }
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(pin),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const saltBytes = hexToBytes(saltHex);
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes.buffer as ArrayBuffer,
      iterations: 100_000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );
  return bytesToHex(new Uint8Array(derivedBits));
}

export function getPinConfig(userId: string): PinLockConfig | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(`${PIN_STORAGE_PREFIX}${userId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PinLockConfig;
  } catch {
    return null;
  }
}

export async function setPinConfig(
  userId: string,
  pin: string,
  timeoutSeconds = 60
): Promise<PinLockConfig> {
  const saltBytes = new Uint8Array(16);
  crypto.getRandomValues(saltBytes);
  const saltHex = bytesToHex(saltBytes);
  const hashHex = await derivePinHashHex(pin, saltHex);
  const config: PinLockConfig = {
    enabled: true,
    saltHex,
    hashHex,
    timeoutSeconds,
    updatedAt: new Date().toISOString(),
  };
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(`${PIN_STORAGE_PREFIX}${userId}`, JSON.stringify(config));
  }
  return config;
}

export async function verifyUserPin(userId: string, candidatePin: string): Promise<boolean> {
  const config = getPinConfig(userId);
  if (!config || !config.enabled) return true;
  if (!/^\d{4,6}$/.test(candidatePin)) return false;
  const candidateHash = await derivePinHashHex(candidatePin, config.saltHex);
  // Constant-time comparison
  if (candidateHash.length !== config.hashHex.length) return false;
  let diff = 0;
  for (let i = 0; i < candidateHash.length; i++) {
    diff |= candidateHash.charCodeAt(i) ^ config.hashHex.charCodeAt(i);
  }
  return diff === 0;
}

export function clearPinConfig(userId: string): void {
  if (typeof window !== 'undefined') {
    window.localStorage.removeItem(`${PIN_STORAGE_PREFIX}${userId}`);
  }
}
