import { TelegramContext } from '../../types';
import { CommandHandler } from './CommandHandler';
import { MessageRenderer } from '../MessageRenderer';

export class StopHandler implements CommandHandler {
  public readonly name = 'stop';
  public readonly description =
    'Powers off a cloud server instance (HIGH RISK: releases underlying capacity)';

  public async execute(ctx: TelegramContext): Promise<void> {
    if (ctx.args.length < 1) {
      await ctx.reply(
        MessageRenderer.error(
          'Stop',
          'N/A',
          'Usage: /stop <server>',
        ),
        'HTML',
      );
      return;
    }

    const alias = ctx.args[0];
    const server = ctx.serverRegistry.getServer(alias);

    if (!server) {
      await ctx.reply(MessageRenderer.notFound(alias), 'HTML');
      return;
    }

    const warning = MessageRenderer.warning(
      'Stop Operation',
      `Server "${alias}" (${server.provider.toUpperCase()}) will be powered off. Starting the server later may fail if the provider is experiencing capacity limits. Consider using /reboot instead.`,
    );

    await ctx.reply(warning, 'HTML');

    await new Promise((resolve) => setTimeout(resolve, 1000));

    const provider = ctx.providerRegistry.getProvider(server.provider);
    await provider.stopServer(server.id, server.region);

    await ctx.reply(
      MessageRenderer.operationStatus('Stop', alias, provider.name, 'Accepted'),
      'HTML',
    );
  }
}
