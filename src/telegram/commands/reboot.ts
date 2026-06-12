import { TelegramContext } from '../../types';
import { CommandHandler } from './CommandHandler';
import { MessageRenderer } from '../MessageRenderer';

export class RebootHandler implements CommandHandler {
  public readonly name = 'reboot';
  public readonly description = 'Reboots/power-cycles a cloud server instance';

  public async execute(ctx: TelegramContext): Promise<void> {
    if (ctx.args.length < 1) {
      await ctx.reply(
        MessageRenderer.error('Reboot', 'N/A', 'Usage: /reboot <server>'),
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

    const provider = ctx.providerRegistry.getProvider(server.provider);
    await provider.rebootServer(server.id, server.region);

    await ctx.reply(
      MessageRenderer.operationStatus('Reboot', alias, provider.name, 'Accepted'),
      'HTML',
    );
  }
}
