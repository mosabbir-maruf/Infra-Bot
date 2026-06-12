import { TelegramUpdate } from '../../types';
import { Env } from '../../config/Env';
import { Logger } from '../../utils/Logger';

/**
 * Validates whether the sender of the Telegram update is authorized to issue commands.
 * Returns true if authorized, false otherwise.
 */
export function isAuthorized(update: TelegramUpdate, env: Env): boolean {
  const sender = update.message?.from || update.callback_query?.from;
  
  if (!sender) {
    Logger.warn('AuthMiddleware: Rejected request. Message payload is missing sender properties.');
    return false;
  }

  const userId = sender.id;
  const authorized = env.AUTHORIZED_USER_IDS.includes(userId);

  if (!authorized) {
    Logger.warn('AuthMiddleware: Unauthorized access attempt rejected.', {
      userId,
      command: update.message?.text || update.callback_query?.data,
      result: 'failure',
    });
    return false;
  }

  Logger.info(`AuthMiddleware: Access granted to user ID ${userId}`, {
    userId,
    command: update.message?.text || update.callback_query?.data,
  });

  return true;
}
