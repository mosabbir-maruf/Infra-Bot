import { TelegramContext } from '../../types';
import { CommandHandler } from './CommandHandler';
import { MessageRenderer } from '../MessageRenderer';

export class StartHandler implements CommandHandler {
  public readonly name = 'start';
  public readonly description = 'Welcome message or starts a stopped server instance';

  public async execute(ctx: TelegramContext): Promise<void> {
    if (ctx.args.length === 0) {
      const welcome = MessageRenderer.header('Infrastructure Bot');
      await ctx.reply(welcome, 'HTML');
      return;
    }

    const alias = ctx.args[0];
    const server = ctx.serverRegistry.getServer(alias);

    if (!server) {
      await ctx.reply(MessageRenderer.notFound(alias), 'HTML');
      return;
    }

    const provider = ctx.providerRegistry.getProvider(server.provider);
    await provider.startServer(server.id, server.region);

    await ctx.reply(
      MessageRenderer.operationStatus('Start', alias, provider.name, 'Accepted'),
      'HTML',
    );
  }
}
