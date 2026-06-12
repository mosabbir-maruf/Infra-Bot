import { TelegramUpdate } from '../../types';
import { Env } from '../../config/Env';
import { Logger } from '../../utils/Logger';

/**
 * Validates whether the sender of the Telegram update is authorized to issue commands.
 * Returns true if authorized, false otherwise.
 */
export function isAuthorized(update: TelegramUpdate, env: Env): boolean {
  const message = update.message;
  if (!message) {
    // Drop silently as it contains no actionable command/message payload
    return false;
  }

  const sender = message.from;
  if (!sender) {
    Logger.warn('AuthMiddleware: Rejected request. Message payload is missing sender properties.');
    return false;
  }

  const userId = sender.id;
  const authorized = env.AUTHORIZED_USER_IDS.includes(userId);

  if (!authorized) {
    Logger.warn('AuthMiddleware: Unauthorized access attempt rejected.', {
      userId,
      command: message.text,
      result: 'failure',
    });
    return false;
  }

  Logger.info(`AuthMiddleware: Access granted to user ID ${userId}`, {
    userId,
    command: message.text,
  });

  return true;
}
