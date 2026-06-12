export interface Env {
  TELEGRAM_BOT_TOKEN: string;
  AUTHORIZED_USER_IDS: number[];
  AWS_ACCESS_KEY_ID?: string;
  AWS_SECRET_ACCESS_KEY?: string;
  AWS_REGION: string;
  DIGITALOCEAN_TOKEN?: string;
  NODE_ENV: string;
  SERVERS_CONFIG: string;
  MONITORING_SECRET: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
}

/**
 * Validates the raw environment bindings passed to the worker handler.
 * Returns a strictly typed Env configuration.
 */
export function validateEnv(rawEnv: unknown): Env {
  if (typeof rawEnv !== 'object' || rawEnv === null) {
    throw new Error('Invalid environment bindings: Config is not an object');
  }

  const envObj = rawEnv as Record<string, string | undefined>;

  const telegramBotToken = envObj.TELEGRAM_BOT_TOKEN;
  if (!telegramBotToken) {
    throw new Error('Configuration Error: TELEGRAM_BOT_TOKEN is not defined');
  }

  const rawUserIds = envObj.AUTHORIZED_USER_IDS;
  if (!rawUserIds) {
    throw new Error('Configuration Error: AUTHORIZED_USER_IDS is not defined');
  }

  const userIds = rawUserIds
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0)
    .map((id) => {
      const parsed = parseInt(id, 10);
      if (isNaN(parsed)) {
        throw new Error(`Configuration Error: Invalid Telegram user ID in AUTHORIZED_USER_IDS: "${id}"`);
      }
      return parsed;
    });

  if (userIds.length === 0) {
    throw new Error('Configuration Error: AUTHORIZED_USER_IDS must contain at least one user ID');
  }

  const serversConfig = envObj.SERVERS_CONFIG;
  if (!serversConfig || serversConfig.trim() === '') {
    throw new Error('Configuration Error: SERVERS_CONFIG is not defined or is empty');
  }

  const monitoringSecret = envObj.MONITORING_SECRET;
  if (!monitoringSecret || monitoringSecret.trim() === '') {
    throw new Error('Configuration Error: MONITORING_SECRET is not defined or is empty');
  }

  return {
    TELEGRAM_BOT_TOKEN: telegramBotToken,
    AUTHORIZED_USER_IDS: userIds,
    AWS_ACCESS_KEY_ID: envObj.AWS_ACCESS_KEY_ID,
    AWS_SECRET_ACCESS_KEY: envObj.AWS_SECRET_ACCESS_KEY,
    AWS_REGION: envObj.AWS_REGION || 'us-east-1',
    DIGITALOCEAN_TOKEN: envObj.DIGITALOCEAN_TOKEN,
    NODE_ENV: envObj.NODE_ENV || 'production',
    SERVERS_CONFIG: serversConfig,
    MONITORING_SECRET: monitoringSecret,
    TELEGRAM_WEBHOOK_SECRET: envObj.TELEGRAM_WEBHOOK_SECRET,
  };
}
