import { Logger } from './Logger';
import { TelegramContext } from '../types';
import { normalizeProviderError } from './ProviderError';

export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;

  constructor(message: string, code: string, statusCode = 500) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

/**
 * Handles errors globally. Logs detailed traces internally and sends a user-friendly message to the Telegram user.
 */
export async function handleError(error: unknown, ctx?: TelegramContext): Promise<void> {
  const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);

  // Log detailed error context internally
  Logger.error(`Error processing Telegram command: ${errorMessage}`, error, {
    userId: ctx?.userId,
    command: ctx?.command,
    result: 'failure',
  });

  if (ctx) {
    try {
      let responseText: string;
      if (error instanceof AppError) {
        responseText = `⚠️ <b>Operation Failed</b>\n\nReason: ${error.message}`;
      } else {
        const normalized = normalizeProviderError(error);
        responseText = `⚠️ <b>Cloud Provider Error</b>\n\nReason: ${normalized}`;
      }

      await ctx.reply(responseText, 'HTML');
    } catch (replyErr) {
      Logger.error('Failed to dispatch error response to user', replyErr);
    }
  }
}
