/**
 * Verifies an HMAC-SHA256 hex signature against a raw message string using the Web Crypto API.
 * The CryptoKey is cached per secret to avoid repeated importKey calls within the same isolate.
 */
const keyCache = new Map<string, CryptoKey>();

async function getKey(secret: string): Promise<CryptoKey> {
  let key = keyCache.get(secret);
  if (!key) {
    const encoder = new TextEncoder();
    key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    keyCache.set(secret, key);
  }
  return key;
}

export async function verifyHmacSignature(
  message: string,
  signatureHex: string,
  secret: string,
): Promise<boolean> {
  try {
    if (signatureHex.length % 2 !== 0) {
      return false;
    }

    const cryptoKey = await getKey(secret);
    const encoder = new TextEncoder();
    const messageData = encoder.encode(message);

    const sigBytes = new Uint8Array(signatureHex.length / 2);
    for (let i = 0; i < sigBytes.length; i++) {
      sigBytes[i] = parseInt(signatureHex.substring(i * 2, i * 2 + 2), 16);
    }

    return await crypto.subtle.verify('HMAC', cryptoKey, sigBytes.buffer, messageData);
  } catch {
    return false;
  }
}
