import { describe, it, expect } from 'vitest';
import { app } from '../src/index';

describe('HTTP Router Endpoints', () => {
  const mockEnv = {
    TELEGRAM_BOT_TOKEN: 'mock-token',
    AUTHORIZED_USER_IDS: '12345',
    AWS_REGION: 'us-east-1',
    NODE_ENV: 'test',
    SERVERS_CONFIG: '{"ai-gateway-prod":{"provider":"aws","region":"ap-south-1","instanceId":"i-0123"}}',
    MONITORING_SECRET: 'mock-secret',
    TELEGRAM_WEBHOOK_SECRET: 'webhook-secret-token',
  };

  it('should return 200 OK and render HTML status dashboard for GET /', async () => {
    const res = await app.request('/', undefined, mockEnv);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    const text = await res.text();
    expect(text).toContain('Infra-Bot · Control Plane');
    expect(text).toContain('ai-gateway-prod');
    expect(text).toContain('i-0123');
  });

  it('should return 200 OK and json status for GET /health', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; timestamp: string };
    expect(body.status).toBe('ok');
    expect(body.timestamp).toBeDefined();
  });

  it('should return 200 OK with correct image/x-icon content type for GET /favicon.ico', async () => {
    const res = await app.request('/favicon.ico');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/x-icon');
    const arrayBuffer = await res.arrayBuffer();
    expect(arrayBuffer.byteLength).toBeGreaterThan(0);
  });

  it('should return 200 OK with correct image/png content type for GET /favicon-32x32.png', async () => {
    const res = await app.request('/favicon-32x32.png');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    const arrayBuffer = await res.arrayBuffer();
    expect(arrayBuffer.byteLength).toBeGreaterThan(0);
  });

  it('should return 200 OK with correct image/png content type for GET /favicon-16x16.png', async () => {
    const res = await app.request('/favicon-16x16.png');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    const arrayBuffer = await res.arrayBuffer();
    expect(arrayBuffer.byteLength).toBeGreaterThan(0);
  });

  it('should return 200 OK and Disallow all for GET /robots.txt', async () => {
    const res = await app.request('/robots.txt');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/plain');
    const text = await res.text();
    expect(text).toContain('User-agent: *');
    expect(text).toContain('Disallow: /');
  });

  it('should return 404 Not Found for non-existing endpoints', async () => {
    const res = await app.request('/non-existent-endpoint');
    expect(res.status).toBe(404);
  });

  describe('Server Registry Backward Compatibility', () => {
    it('should parse legacy registry configurations using generic "id" keys', async () => {
      const legacyEnv = {
        ...mockEnv,
        SERVERS_CONFIG: '{"legacy-aws":{"provider":"aws","id":"i-legacy123"},"legacy-do":{"provider":"digitalocean","id":99999}}',
      };
      const res = await app.request('/', undefined, legacyEnv);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('legacy-aws');
      expect(text).toContain('i-legacy123');
      expect(text).toContain('legacy-do');
      expect(text).toContain('99999');
    });

    it('should parse explicit provider-specific configurations using "instanceId" and "dropletId" keys', async () => {
      const explicitEnv = {
        ...mockEnv,
        SERVERS_CONFIG: '{"new-aws":{"provider":"aws","instanceId":"i-new123"},"new-do":{"provider":"digitalocean","dropletId":"88888"}}',
      };
      const res = await app.request('/', undefined, explicitEnv);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('new-aws');
      expect(text).toContain('i-new123');
      expect(text).toContain('new-do');
      expect(text).toContain('88888');
    });
  });

  describe('POST /webhook Verification', () => {
    const updatePayload = {
      update_id: 1,
      message: {
        message_id: 100,
        chat: { id: 999, type: 'private' },
        date: 1718200000,
        text: '/status',
        from: { id: 12345, is_bot: false, first_name: 'Alice' },
      },
    };

    it('should return 403 Forbidden if secret token is configured but missing in headers', async () => {
      const res = await app.request(
        '/webhook',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updatePayload),
        },
        mockEnv,
      );
      expect(res.status).toBe(403);
      expect(await res.text()).toContain('Forbidden: Webhook Secret Mismatch');
    });

    it('should return 403 Forbidden if secret token is configured but does not match', async () => {
      const res = await app.request(
        '/webhook',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Telegram-Bot-Api-Secret-Token': 'wrong-token',
          },
          body: JSON.stringify(updatePayload),
        },
        mockEnv,
      );
      expect(res.status).toBe(403);
    });

    it('should bypass secret check if TELEGRAM_WEBHOOK_SECRET is not configured', async () => {
      const envWithoutSecret = { ...mockEnv, TELEGRAM_WEBHOOK_SECRET: '' };
      const res = await app.request(
        '/webhook',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updatePayload),
        },
        envWithoutSecret,
      );
      expect(res.status).toBe(200);
    });

    it('should authorize and accept request if secret token matches', async () => {
      const res = await app.request(
        '/webhook',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Telegram-Bot-Api-Secret-Token': 'webhook-secret-token',
          },
          body: JSON.stringify(updatePayload),
        },
        mockEnv,
      );
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('Accepted');
    });
  });

  describe('POST /monitoring/report Ingestion', () => {
    it('should return 500 configuration error if MONITORING_KV is not bound', async () => {
      const res = await app.request(
        '/monitoring/report',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Signature': 'mock-sig',
            'X-Server-Alias': 'ai-gateway-prod',
          },
          body: JSON.stringify({ timestamp: Math.floor(Date.now() / 1000) }),
        },
        mockEnv,
      );
      expect(res.status).toBe(500);
      expect(await res.text()).toContain('Configuration Error: MONITORING_KV binding is missing.');
    });
  });
});
