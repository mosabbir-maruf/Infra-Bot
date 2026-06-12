/**
 * Verifies an HMAC-SHA256 hex signature against a raw message string using the Web Crypto API.
 */
export async function verifyHmacSignature(
  message: string,
  signatureHex: string,
  secret: string,
): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const messageData = encoder.encode(message);

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );

    if (signatureHex.length % 2 !== 0) {
      return false;
    }

    const sigBytes = new Uint8Array(signatureHex.length / 2);
    for (let i = 0; i < sigBytes.length; i++) {
      sigBytes[i] = parseInt(signatureHex.substring(i * 2, i * 2 + 2), 16);
    }

    return await crypto.subtle.verify('HMAC', cryptoKey, sigBytes.buffer, messageData);
  } catch {
    return false;
  }
}
