import { TelegramContext, TelegramMessage } from '../types';
import { Env } from '../config/Env';
import { TelegramClient } from './TelegramClient';
import { Logger } from '../utils/Logger';
import { handleError } from '../utils/ErrorHandler';
import { MessageRenderer } from './MessageRenderer';
import { CommandHandler } from './commands/CommandHandler';
import { ServerRegistry } from '../config/ServerRegistry';
import { ProviderRegistry } from '../providers/ProviderRegistry';

import { StartHandler } from './commands/start';
import { HelpHandler } from './commands/help';
import { HealthHandler } from './commands/health';
import { StatusHandler } from './commands/status';
import { StopHandler } from './commands/stop';
import { RebootHandler } from './commands/reboot';
import { ReportHandler } from './commands/report';
import { BandwidthHandler } from './commands/bandwidth';
import { DockerHandler } from './commands/docker';
import { UptimeHandler } from './commands/uptime';

export class CommandRouter {
  private readonly handlers = new Map<string, CommandHandler>();

  constructor() {
    this.register(new StartHandler());
    this.register(new HelpHandler());
    this.register(new HealthHandler());
    this.register(new StatusHandler());
    this.register(new StopHandler());
    this.register(new RebootHandler());
    this.register(new ReportHandler());
    this.register(new BandwidthHandler());
    this.register(new DockerHandler());
    this.register(new UptimeHandler());
  }

  private register(handler: CommandHandler): void {
    this.handlers.set(handler.name.toLowerCase(), handler);
  }

  public getRegisteredCommands(): CommandHandler[] {
    return Array.from(this.handlers.values());
  }

  public async route(
    message: TelegramMessage,
    env: Env,
    serverRegistry: ServerRegistry,
    providerRegistry: ProviderRegistry,
    rawEnv?: Record<string, unknown>,
  ): Promise<void> {
    const text = message.text?.trim() || '';
    if (!text.startsWith('/')) {
      return;
    }

    const tokens = text.split(/\s+/);
    const commandWithBot = tokens[0].substring(1);
    const command = commandWithBot.split('@')[0].toLowerCase();
    const args = tokens.slice(1);

    const client = new TelegramClient(env.TELEGRAM_BOT_TOKEN);
    const reply = async (
      replyText: string,
      parseMode?: 'MarkdownV2' | 'HTML' | 'Markdown',
    ): Promise<void> => {
      await client.sendMessage(message.chat.id, replyText, parseMode);
    };

    const userId = message.from?.id || 0;
    const ctx: TelegramContext = {
      message,
      env,
      userId,
      command: `/${command}`,
      args,
      reply,
      serverRegistry,
      providerRegistry,
      telegramClient: client,
      monitoringKv: (rawEnv?.MONITORING_KV) as TelegramContext['monitoringKv'],
    };

    const handler = this.handlers.get(command);
    if (!handler) {
      Logger.warn(`CommandRouter: Unknown command "/${command}" from user ID ${userId}`);
      await reply(MessageRenderer.unknownCommand(`/${command}`), 'HTML');
      return;
    }

    Logger.info(`CommandRouter: Processing command "/${command}" from user ID ${userId}`, {
      userId,
      command: `/${command}`,
    });

    try {
      await handler.execute(ctx);
      Logger.info(`CommandRouter: Completed command "/${command}" for user ID ${userId}`, {
        userId,
        command: `/${command}`,
        result: 'success',
      });
    } catch (err) {
      await handleError(err, ctx);
    }
  }
}
