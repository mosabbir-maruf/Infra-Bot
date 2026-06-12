/**
 * Normalizes cloud provider exceptions into human-readable strings.
 */
export function normalizeProviderError(err: unknown): string {
  if (!err) {
    return 'Unknown provider error occurred.';
  }

  if (err instanceof Error) {
    const msg = err.message;

    // AWS SDK Errors
    if (msg.includes('AuthFailure') || msg.includes('signature') || msg.includes('Credential')) {
      return 'Authentication failed: Invalid AWS credentials.';
    }
    if (msg.includes('UnauthorizedOperation')) {
      return 'Security violation: IAM user lacks permission for this action.';
    }
    if (msg.includes('InsufficientInstanceCapacity')) {
      return 'Capacity Error: AWS does not have enough capacity in this zone for the requested instance type.';
    }
    if (msg.includes('InstanceLimitExceeded')) {
      return 'Limit Exceeded: Target EC2 instance limit has been reached for this account.';
    }
    if (msg.includes('Rate exceeded') || msg.includes('Throttling')) {
      return 'Rate Limit: AWS requests are being throttled. Please slow down.';
    }

    // DigitalOcean Errors
    if (msg.includes('DigitalOcean API error (401)')) {
      return 'Authentication failed: Invalid DigitalOcean token.';
    }
    if (msg.includes('DigitalOcean API error (404)')) {
      return 'Resource not found: The requested droplet does not exist.';
    }
    if (msg.includes('DigitalOcean API error (429)')) {
      return 'Rate Limit: DigitalOcean request quota exceeded.';
    }
    if (msg.includes('DigitalOcean API error')) {
      // Clean up DO API error messages
      return `DigitalOcean request failed: ${msg.replace('DigitalOcean API error', '').trim()}`;
    }

    return msg;
  }

  if (typeof err === 'string') {
    return err;
  }

  try {
    return JSON.stringify(err);
  } catch {
    return 'An un-serializable cloud provider error occurred.';
  }
}
