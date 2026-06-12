import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommandRouter } from '../src/telegram/CommandRouter';
import { TelegramMessage, TelegramCallbackQuery } from '../src/types';
import { Env } from '../src/config/Env';
import { TelegramClient } from '../src/telegram/TelegramClient';
import { ServerRegistry } from '../src/config/ServerRegistry';
import { ProviderRegistry } from '../src/providers/ProviderRegistry';
import { AWSProvider } from '../src/providers/AWSProvider';

vi.mock('../src/utils/Logger', () => ({
  Logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('CallbackQuery and Selection UX', () => {
  const mockEnv: Env = {
    TELEGRAM_BOT_TOKEN: 'mock-bot-token',
    AUTHORIZED_USER_IDS: [12345],
    AWS_REGION: 'us-east-1',
    AWS_ACCESS_KEY_ID: 'mock-key',
    AWS_SECRET_ACCESS_KEY: 'mock-secret',
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

    vi.spyOn(AWSProvider.prototype, 'getServerStatus').mockResolvedValue({
      id: 'i-0123',
      name: 'ai-gateway-prod',
      status: 'running',
      ipAddress: '1.2.3.4',
      provider: 'AWS',
      region: 'ap-south-1',
    });

    vi.spyOn(AWSProvider.prototype, 'getInstanceMetadata').mockResolvedValue({
      instanceId: 'i-0123',
      instanceType: 't3.medium',
      state: 'running',
      publicIp: '1.2.3.4',
    });
  });

  it('should render server selection keyboard when command is run without arguments', async () => {
    const mockSendMessage = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(TelegramClient.prototype, 'sendMessage').mockImplementation(mockSendMessage);

    const message: TelegramMessage = {
      message_id: 1,
      chat: { id: 999, type: 'private' },
      date: 1718200000,
      text: '/status',
      from: { id: 12345, is_bot: false, first_name: 'Alice' },
    };

    await router.route(message, mockEnv, serverRegistry, providerRegistry);

    expect(mockSendMessage).toHaveBeenCalled();
    const [chatId, text, _parseMode, replyMarkup] = mockSendMessage.mock.calls[0];
    expect(chatId).toBe(999);
    expect(text).toContain('Select a server');
    expect(replyMarkup).toBeDefined();
    expect(replyMarkup.inline_keyboard[0][0].text).toBe('ai-gateway-prod');
    expect(replyMarkup.inline_keyboard[0][0].callback_data).toBe('status:ai-gateway-prod');
  });

  it('should route non-destructive callback action directly to handler', async () => {
    const mockEditMessageText = vi.fn().mockResolvedValue(undefined);
    const mockAnswerCallbackQuery = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(TelegramClient.prototype, 'editMessageText').mockImplementation(mockEditMessageText);
    vi.spyOn(TelegramClient.prototype, 'answerCallbackQuery').mockImplementation(mockAnswerCallbackQuery);

    const query: TelegramCallbackQuery = {
      id: 'query-123',
      from: { id: 12345, is_bot: false, first_name: 'Alice' },
      message: {
        message_id: 456,
        chat: { id: 999, type: 'private' },
        date: 1718200000,
        text: 'Select a server',
      },
      data: 'status:ai-gateway-prod',
    };

    await router.routeCallbackQuery(query, mockEnv, serverRegistry, providerRegistry);

    expect(mockAnswerCallbackQuery).toHaveBeenCalledWith('query-123');
    expect(mockEditMessageText).toHaveBeenCalled();
    const [chatId, messageId, text] = mockEditMessageText.mock.calls[0];
    expect(chatId).toBe(999);
    expect(messageId).toBe(456);
    expect(text).toContain('ai-gateway-prod');
  });

  it('should present confirmation dialog for destructive actions', async () => {
    const mockEditMessageText = vi.fn().mockResolvedValue(undefined);
    const mockAnswerCallbackQuery = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(TelegramClient.prototype, 'editMessageText').mockImplementation(mockEditMessageText);
    vi.spyOn(TelegramClient.prototype, 'answerCallbackQuery').mockImplementation(mockAnswerCallbackQuery);

    const query: TelegramCallbackQuery = {
      id: 'query-123',
      from: { id: 12345, is_bot: false, first_name: 'Alice' },
      message: {
        message_id: 456,
        chat: { id: 999, type: 'private' },
        date: 1718200000,
        text: 'Select a server',
      },
      data: 'reboot_confirm:ai-gateway-prod',
    };

    await router.routeCallbackQuery(query, mockEnv, serverRegistry, providerRegistry);

    expect(mockAnswerCallbackQuery).toHaveBeenCalledWith('query-123');
    expect(mockEditMessageText).toHaveBeenCalled();
    const [chatId, messageId, text, _, replyMarkup] = mockEditMessageText.mock.calls[0];
    expect(chatId).toBe(999);
    expect(messageId).toBe(456);
    expect(text).toContain('Confirm reboot?');
    expect(text).toContain('ai-gateway-prod');
    expect(replyMarkup.inline_keyboard[0][0].text).toBe('Confirm');
    expect(replyMarkup.inline_keyboard[0][0].callback_data).toBe('reboot_execute:ai-gateway-prod');
    expect(replyMarkup.inline_keyboard[0][1].text).toBe('Cancel');
    expect(replyMarkup.inline_keyboard[0][1].callback_data).toBe('cancel');
  });

  it('should handle cancel action callback', async () => {
    const mockEditMessageText = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(TelegramClient.prototype, 'editMessageText').mockImplementation(mockEditMessageText);

    const query: TelegramCallbackQuery = {
      id: 'query-123',
      from: { id: 12345, is_bot: false, first_name: 'Alice' },
      message: {
        message_id: 456,
        chat: { id: 999, type: 'private' },
        date: 1718200000,
        text: 'Confirm reboot?',
      },
      data: 'cancel',
    };

    await router.routeCallbackQuery(query, mockEnv, serverRegistry, providerRegistry);

    expect(mockEditMessageText).toHaveBeenCalledWith(999, 456, 'Operation cancelled.');
  });

  it('should execute destructive operation upon execution confirmation callback', async () => {
    const mockEditMessageText = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(TelegramClient.prototype, 'editMessageText').mockImplementation(mockEditMessageText);

    const mockReboot = vi.fn().mockResolvedValue(undefined);
    const mockProvider = providerRegistry.getProvider('AWS') as AWSProvider;
    vi.spyOn(mockProvider, 'rebootServer').mockImplementation(mockReboot);

    const query: TelegramCallbackQuery = {
      id: 'query-123',
      from: { id: 12345, is_bot: false, first_name: 'Alice' },
      message: {
        message_id: 456,
        chat: { id: 999, type: 'private' },
        date: 1718200000,
        text: 'Confirm reboot?',
      },
      data: 'reboot_execute:ai-gateway-prod',
    };

    await router.routeCallbackQuery(query, mockEnv, serverRegistry, providerRegistry);

    expect(mockReboot).toHaveBeenCalledWith('i-0123', 'ap-south-1');
    expect(mockEditMessageText).toHaveBeenCalled();
    const [_, __, text] = mockEditMessageText.mock.calls[0];
    expect(text).toContain('Reboot');
    expect(text).toContain('Accepted');
  });
});
