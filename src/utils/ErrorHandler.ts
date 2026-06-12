import { Logger } from './Logger';
import { TelegramContext } from '../types';
import { MessageRenderer } from '../telegram/MessageRenderer';
import { AppError } from '../errors';

export { AppError } from '../errors';
export {
  ValidationError,
  AuthorizationError,
  ProviderError,
  MonitoringError,
  ConfigurationError,
} from '../errors';

function normalizeProviderError(err: unknown): string {
  if (!err) {
    return 'Unknown provider error occurred.';
  }

  if (err instanceof Error) {
    const msg = err.message;

    if (msg.includes('AuthFailure') || msg.includes('signature') || msg.includes('Credential')) {
      return 'Provider authentication failed. Check credentials.';
    }
    if (msg.includes('UnauthorizedOperation')) {
      return 'Provider access denied. Check IAM permissions.';
    }
    if (msg.includes('Timeout') || msg.includes('timed out') || msg.includes('ETIMEDOUT')) {
      return 'Provider communication timeout.';
    }
    if (msg.includes('InsufficientInstanceCapacity')) {
      return 'Provider does not have enough capacity for the requested instance type.';
    }
    if (msg.includes('InstanceLimitExceeded')) {
      return 'Provider instance limit reached for this account.';
    }
    if (msg.includes('Rate exceeded') || msg.includes('Throttling')) {
      return 'Provider rate limit exceeded. Try again shortly.';
    }

    if (msg.includes('404') || msg.includes('not found') || msg.includes('Not Found')) {
      return 'Provider resource not found.';
    }
    if (msg.includes('401') || msg.includes('403') || msg.includes('Unauthorized')) {
      return 'Provider authorization failed.';
    }

    if (msg.includes('fetch') || msg.includes('network') || msg.includes('DNS')) {
      return 'Provider network error.';
    }

    return 'Provider request failed.';
  }

  return 'An unexpected error occurred.';
}

export function handleError(error: unknown, ctx?: TelegramContext): void {
  const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);

  Logger.error(`Error processing Telegram command: ${errorMessage}`, error, {
    userId: ctx?.userId,
    command: ctx?.command,
    result: 'failure',
  });

  if (ctx) {
    try {
      let responseText: string;

      if (error instanceof AppError) {
        if (error.code === 'VALIDATION_ERROR') {
          responseText = MessageRenderer.generalError(error.message);
        } else if (error.code === 'AUTHORIZATION_ERROR') {
          responseText = MessageRenderer.generalError('Access denied.');
        } else if (error.code === 'PROVIDER_ERROR') {
          const reason = normalizeProviderError(error);
          responseText = MessageRenderer.generalError(reason);
        } else {
          responseText = MessageRenderer.generalError(error.message);
        }
      } else {
        const reason = normalizeProviderError(error);
        responseText = MessageRenderer.generalError(reason);
      }

      ctx.reply(responseText, 'HTML');
    } catch (replyErr) {
      Logger.error('Failed to dispatch error response to user', replyErr);
    }
  }
}
