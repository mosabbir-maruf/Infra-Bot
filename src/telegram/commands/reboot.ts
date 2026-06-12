import { TelegramContext } from '../../types';
import { CommandHandler } from './CommandHandler';

export class RebootHandler implements CommandHandler {
  public readonly name = 'reboot';
  public readonly description = 'Reboots/power-cycles a cloud server instance';

  public async execute(ctx: TelegramContext): Promise<void> {
    if (ctx.args.length < 1) {
      await ctx.reply('⚠️ <b>Syntax Error</b>\nUsage: <code>/reboot &lt;server_alias&gt;</code>', 'HTML');
      return;
    }

    const alias = ctx.args[0];
    const server = ctx.serverRegistry.getServer(alias);

    if (!server) {
      await ctx.reply(
        `⚠️ <b>Error:</b> Server alias <code>${alias}</code> not found in the registry.`,
        'HTML',
      );
      return;
    }

    await ctx.reply(
      `⏳ <b>Rebooting server</b> <code>${alias}</code> (${server.provider.toUpperCase()})...`,
      'HTML',
    );

    const provider = ctx.providerRegistry.getProvider(server.provider);
    await provider.rebootServer(server.id, server.region);

    await ctx.reply(
      `✅ <b>Reboot command issued successfully</b>\nServer <code>${alias}</code> is rebooting. Run /status to verify state changes.`,
      'HTML',
    );
  }
}
