import { Logger } from '../utils/Logger';
import { escapeMarkdownV2 } from './Escaper';

export class TelegramClient {
  private readonly baseUrl: string;

  constructor(token: string) {
    this.baseUrl = `https://api.telegram.org/bot${token}`;
  }

  /**
   * Sends a message to a specific chat via Telegram Bot API
   */
  public async sendMessage(
    chatId: number,
    text: string,
    parseMode?: 'MarkdownV2' | 'HTML' | 'Markdown',
    replyMarkup?: Record<string, unknown>,
  ): Promise<void> {
    const url = `${this.baseUrl}/sendMessage`;
    const safeText = parseMode === 'MarkdownV2' ? escapeMarkdownV2(text) : text;
    const body = {
      chat_id: chatId,
      text: safeText,
      parse_mode: parseMode,
      reply_markup: replyMarkup,
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Telegram API error (${response.status}): ${errorText}`);
      }
    } catch (err) {
      Logger.error(`TelegramClient: Failed to send message to chat ${chatId}`, err);
      throw err;
    }
  }

  /**
   * Edits a message's text via Telegram Bot API
   */
  public async editMessageText(
    chatId: number,
    messageId: number,
    text: string,
    parseMode?: 'MarkdownV2' | 'HTML' | 'Markdown',
    replyMarkup?: Record<string, unknown>,
  ): Promise<void> {
    const url = `${this.baseUrl}/editMessageText`;
    const safeText = parseMode === 'MarkdownV2' ? escapeMarkdownV2(text) : text;
    const body = {
      chat_id: chatId,
      message_id: messageId,
      text: safeText,
      parse_mode: parseMode,
      reply_markup: replyMarkup,
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Telegram API error (${response.status}): ${errorText}`);
      }
    } catch (err) {
      Logger.error(`TelegramClient: Failed to edit message ${messageId} in chat ${chatId}`, err);
      throw err;
    }
  }

  /**
   * Answers a callback query via Telegram Bot API to clear loading spinner
   */
  public async answerCallbackQuery(
    callbackQueryId: string,
    text?: string,
    showAlert?: boolean,
  ): Promise<void> {
    const url = `${this.baseUrl}/answerCallbackQuery`;
    const body = {
      callback_query_id: callbackQueryId,
      text,
      show_alert: showAlert,
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Telegram API error (${response.status}): ${errorText}`);
      }
    } catch (err) {
      Logger.error(`TelegramClient: Failed to answer callback query ${callbackQueryId}`, err);
      throw err;
    }
  }
}
