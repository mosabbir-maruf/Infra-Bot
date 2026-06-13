import { Env } from '../config/Env';
import { ServerRegistry } from '../config/ServerRegistry';
import { ProviderRegistry } from '../providers/ProviderRegistry';
import { TelegramClient } from '../telegram/TelegramClient';

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  inline_message_id?: string;
  chat_instance?: string;
  data?: string;
  game_short_name?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface TelegramContext {
  message: TelegramMessage;
  env: Env;
  userId: number;
  command: string;
  args: string[];
  reply(text: string, parseMode?: 'MarkdownV2' | 'HTML' | 'Markdown', replyMarkup?: Record<string, unknown>): Promise<void>;
  serverRegistry: ServerRegistry;
  providerRegistry: ProviderRegistry;
  telegramClient: TelegramClient;
  monitoringKv?: { get(key: string): Promise<string | null>; put(key: string, val: string, options?: { expirationTtl?: number }): Promise<void>; delete(key: string): Promise<void> };
}

