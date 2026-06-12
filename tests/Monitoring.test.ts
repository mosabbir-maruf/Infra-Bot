import { describe, it, expect } from 'vitest';
import { verifyHmacSignature } from '../src/utils/Crypto';
import * as crypto from 'crypto';

describe('HMAC Signature Verification', () => {
  const secret = 'super-secret-monitoring-key';
  const payload = JSON.stringify({
    timestamp: 1718200000,
    cpu: '15.4',
    ram: { total: 4096, used: 2048 },
  });

  it('should return true for valid HMAC-SHA256 signatures', async () => {
    const expectedHex = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    const isValid = await verifyHmacSignature(payload, expectedHex, secret);
    expect(isValid).toBe(true);
  });

  it('should return false for invalid signature strings', async () => {
    const badHex = 'deadbeef1234567890abcdef1234567890abcdef1234567890abcdef12345678';
    const isValid = await verifyHmacSignature(payload, badHex, secret);
    expect(isValid).toBe(false);
  });

  it('should return false for malformed signatures (odd-length hex strings)', async () => {
    const malformedHex = 'abc';
    const isValid = await verifyHmacSignature(payload, malformedHex, secret);
    expect(isValid).toBe(false);
  });
});
