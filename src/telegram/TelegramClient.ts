import { Logger } from '../utils/Logger';

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
  ): Promise<void> {
    const url = `${this.baseUrl}/sendMessage`;
    const body = {
      chat_id: chatId,
      text,
      parse_mode: parseMode,
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
}
