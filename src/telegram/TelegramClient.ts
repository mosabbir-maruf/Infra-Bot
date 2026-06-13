import { escapeMarkdownV2 } from './Escaper';

export class TelegramClient {
  private readonly baseUrl: string;
  private static readonly POST_HEADERS = { 'Content-Type': 'application/json' };

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

    const response = await fetch(url, {
      method: 'POST',
      headers: TelegramClient.POST_HEADERS,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Telegram API error (${response.status}): ${errorText}`);
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

    const response = await fetch(url, {
      method: 'POST',
      headers: TelegramClient.POST_HEADERS,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Telegram API error (${response.status}): ${errorText}`);
    }
  }

  /**
   * Deletes a message from a chat via Telegram Bot API
   */
  public async deleteMessage(chatId: number, messageId: number): Promise<void> {
    const url = `${this.baseUrl}/deleteMessage`;
    const body = {
      chat_id: chatId,
      message_id: messageId,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: TelegramClient.POST_HEADERS,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Telegram API error (${response.status}): ${errorText}`);
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

    const response = await fetch(url, {
      method: 'POST',
      headers: TelegramClient.POST_HEADERS,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Telegram API error (${response.status}): ${errorText}`);
    }
  }
}
