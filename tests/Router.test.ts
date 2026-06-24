import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommandRouter } from '../src/telegram/CommandRouter';
import { TelegramMessage } from '../src/types';
import { Env } from '../src/config/Env';
import { TelegramClient } from '../src/telegram/TelegramClient';
import { ServerRegistry } from '../src/config/ServerRegistry';
import { ProviderRegistry } from '../src/providers/ProviderRegistry';

// Mock logger
vi.mock('../src/utils/Logger', () => ({
  Logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('CommandRouter', () => {
  const mockEnv: Env = {
    TELEGRAM_BOT_TOKEN: 'mock-bot-token',
    AUTHORIZED_USER_IDS: [12345],
    AWS_REGION: 'us-east-1',
    AZURE_REGION: 'eastus',
    NODE_ENV: 'test',
    SERVERS_CONFIG: '{"ai-gateway-prod":{"provider":"aws","region":"ap-south-1","instanceId":"i-0123"}}',
    MONITORING_SECRET: 'mock-secret',
  };

  const serverRegistry = new ServerRegistry(mockEnv.SERVERS_CONFIG);
  const providerRegistry = new ProviderRegistry(mockEnv);

  let router: CommandRouter;

  beforeEach(() => {
    router = new CommandRouter();
    vi.clearAllMocks();
  });

  it('should route /help to HelpHandler', async () => {
    const mockSendMessage = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(TelegramClient.prototype, 'sendMessage').mockImplementation(mockSendMessage);

    const message: TelegramMessage = {
      message_id: 1,
      chat: { id: 999, type: 'private' },
      date: 1718200000,
      text: '/help',
      from: { id: 12345, is_bot: false, first_name: 'Alice' },
    };

    await router.route(message, mockEnv, serverRegistry, providerRegistry);

    expect(mockSendMessage).toHaveBeenCalled();
    const [chatId, text, parseMode] = mockSendMessage.mock.calls[0];
    expect(chatId).toBe(999);
    expect(text).toContain('Infra-Bot');
    expect(parseMode).toBe('HTML');
  });

  it('should render server selection keyboard when /start is run without arguments', async () => {
    const mockSendMessage = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(TelegramClient.prototype, 'sendMessage').mockImplementation(mockSendMessage);

    const message: TelegramMessage = {
      message_id: 2,
      chat: { id: 999, type: 'private' },
      date: 1718200000,
      text: '/start',
      from: { id: 12345, is_bot: false, first_name: 'Alice' },
    };

    await router.route(message, mockEnv, serverRegistry, providerRegistry);

    expect(mockSendMessage).toHaveBeenCalled();
    const [_, text, _parseMode, replyMarkup] = mockSendMessage.mock.calls[0];
    expect(text).toContain('Select a server');
    expect(replyMarkup).toBeDefined();
  });

  it('should print unknown command warning for unknown commands', async () => {
    const mockSendMessage = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(TelegramClient.prototype, 'sendMessage').mockImplementation(mockSendMessage);

    const message: TelegramMessage = {
      message_id: 3,
      chat: { id: 999, type: 'private' },
      date: 1718200000,
      text: '/unsupportedcmd',
      from: { id: 12345, is_bot: false, first_name: 'Alice' },
    };

    await router.route(message, mockEnv, serverRegistry, providerRegistry);

    expect(mockSendMessage).toHaveBeenCalled();
    const [_, text, parseMode] = mockSendMessage.mock.calls[0];
    expect(text).toContain('Unknown Command');
    expect(parseMode).toBe('HTML');
  });

  it('should ignore text messages that do not start with a slash', async () => {
    const mockSendMessage = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(TelegramClient.prototype, 'sendMessage').mockImplementation(mockSendMessage);

    const message: TelegramMessage = {
      message_id: 4,
      chat: { id: 999, type: 'private' },
      date: 1718200000,
      text: 'hello bot',
      from: { id: 12345, is_bot: false, first_name: 'Alice' },
    };

    await router.route(message, mockEnv, serverRegistry, providerRegistry);

    expect(mockSendMessage).not.toHaveBeenCalled();
  });
});
