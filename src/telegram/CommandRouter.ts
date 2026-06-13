import { TelegramContext, TelegramMessage, TelegramCallbackQuery } from '../types';
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
import { SetBandwidthHandler } from './commands/setbandwidth';
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
    this.register(new SetBandwidthHandler());
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
      replyMarkup?: Record<string, unknown>,
    ): Promise<void> => {
      await client.sendMessage(message.chat.id, replyText, parseMode, replyMarkup);
    };

    const userId = message.from?.id || 0;

    // Check if it's one of the commands that should prompt for server selection
    const selectionCommands = ['status', 'start', 'stop', 'reboot', 'uptime', 'bandwidth', 'docker'];
    if (selectionCommands.includes(command) && args.length === 0) {
      const aliases = serverRegistry.getAliases();
      if (aliases.length === 0) {
        await reply(MessageRenderer.noServers(), 'HTML');
        return;
      }

      const inlineKeyboard = aliases.map((alias) => {
        const isDestructive = ['stop', 'reboot'].includes(command);
        const callbackData = isDestructive ? `${command}_confirm:${alias}` : `${command}:${alias}`;
        return [{ text: alias, callback_data: callbackData }];
      });

      await reply('Select a server', undefined, { inline_keyboard: inlineKeyboard });
      return;
    }

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

  public async routeCallbackQuery(
    callbackQuery: TelegramCallbackQuery,
    env: Env,
    serverRegistry: ServerRegistry,
    providerRegistry: ProviderRegistry,
    rawEnv?: Record<string, unknown>,
  ): Promise<void> {
    const data = callbackQuery.data || '';
    const client = new TelegramClient(env.TELEGRAM_BOT_TOKEN);
    const callbackQueryId = callbackQuery.id;

    try {
      await client.answerCallbackQuery(callbackQueryId);
    } catch (err) {
      Logger.error('Failed to answer callback query', err);
    }

    const message = callbackQuery.message;
    if (!message) return;

    const chatId = message.chat.id;
    const messageId = message.message_id;

    const separatorIndex = data.indexOf(':');
    if (separatorIndex === -1) {
      if (data.startsWith('cancel')) {
        await client.editMessageText(chatId, messageId, 'Operation cancelled.');
      }
      return;
    }

    const action = data.substring(0, separatorIndex);
    const alias = data.substring(separatorIndex + 1);

    if (action.endsWith('_confirm')) {
      const command = action.replace('_confirm', '');
      const keyboard = {
        inline_keyboard: [
          [
            { text: 'Confirm', callback_data: `${command}_execute:${alias}` },
            { text: 'Cancel', callback_data: 'cancel' }
          ]
        ]
      };
      await client.editMessageText(
        chatId,
        messageId,
        `Confirm ${command}?\n\nServer: ${alias}`,
        undefined,
        keyboard
      );
      return;
    }

    let commandName = action;
    if (action.endsWith('_execute')) {
      commandName = action.replace('_execute', '');
    }

    const handler = this.handlers.get(commandName);
    if (!handler) {
      Logger.warn(`CommandRouter callback: Unknown command "${commandName}"`);
      return;
    }

    const reply = async (
      replyText: string,
      parseMode?: 'MarkdownV2' | 'HTML' | 'Markdown',
      replyMarkup?: Record<string, unknown>,
    ): Promise<void> => {
      await client.editMessageText(chatId, messageId, replyText, parseMode, replyMarkup);
    };

    const userId = callbackQuery.from.id;
    const ctx: TelegramContext = {
      message,
      env,
      userId,
      command: `/${commandName}`,
      args: [alias],
      reply,
      serverRegistry,
      providerRegistry,
      telegramClient: client,
      monitoringKv: (rawEnv?.MONITORING_KV) as TelegramContext['monitoringKv'],
    };

    try {
      await handler.execute(ctx);
    } catch (err) {
      await handleError(err, ctx);
    }
  }
}
