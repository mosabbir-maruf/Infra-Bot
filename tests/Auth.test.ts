import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isAuthorized } from '../src/telegram/middleware/AuthMiddleware';
import { TelegramUpdate } from '../src/types';
import { Env } from '../src/config/Env';

// Silence console logs during testing
vi.mock('../src/utils/Logger', () => ({
  Logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('AuthMiddleware', () => {
  const mockEnv: Env = {
    TELEGRAM_BOT_TOKEN: 'test-token',
    AUTHORIZED_USER_IDS: [12345, 67890],
    AWS_REGION: 'us-east-1',
    NODE_ENV: 'test',
    SERVERS_CONFIG: '{"ai-gateway-prod":{"provider":"aws","region":"ap-south-1","id":"i-0123"}}',
    MONITORING_SECRET: 'mock-secret',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return true and authorize whitelisted user IDs', () => {
    const update: TelegramUpdate = {
      update_id: 1,
      message: {
        message_id: 100,
        chat: { id: 999, type: 'private' },
        date: 1718200000,
        text: '/status',
        from: { id: 12345, is_bot: false, first_name: 'Alice' },
      },
    };
    expect(isAuthorized(update, mockEnv)).toBe(true);
  });

  it('should return false and reject non-whitelisted user IDs', () => {
    const update: TelegramUpdate = {
      update_id: 2,
      message: {
        message_id: 101,
        chat: { id: 999, type: 'private' },
        date: 1718200000,
        text: '/status',
        from: { id: 11111, is_bot: false, first_name: 'Mallory' },
      },
    };
    expect(isAuthorized(update, mockEnv)).toBe(false);
  });

  it('should return false if sender field is missing', () => {
    const update: TelegramUpdate = {
      update_id: 3,
      message: {
        message_id: 102,
        chat: { id: 999, type: 'private' },
        date: 1718200000,
        text: '/status',
      },
    };
    expect(isAuthorized(update, mockEnv)).toBe(false);
  });

  it('should return false if message payload is missing', () => {
    const update: TelegramUpdate = {
      update_id: 4,
    };
    expect(isAuthorized(update, mockEnv)).toBe(false);
  });
});
