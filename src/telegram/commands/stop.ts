import { TelegramContext } from '../../types';
import { CommandHandler } from './CommandHandler';

export class StopHandler implements CommandHandler {
  public readonly name = 'stop';
  public readonly description =
    'Powers off a cloud server instance (HIGH RISK: releases underlying capacity)';

  public async execute(ctx: TelegramContext): Promise<void> {
    if (ctx.args.length < 1) {
      await ctx.reply('⚠️ <b>Syntax Error</b>\nUsage: <code>/stop &lt;server_alias&gt;</code>', 'HTML');
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

    // Deliver critical warning to the operator
    const warning = `⚠️ <b>CRITICAL WARNING: Stop Operation</b>
Stopping server <code>${alias}</code> (${server.provider.toUpperCase()}) will release its underlying hardware capacity. 
Starting the server later may fail if the provider is experiencing capacity limits. 

<b>Preferred action for active nodes is <code>/reboot</code>.</b>
Proceeding with power off...`;

    await ctx.reply(warning, 'HTML');

    // Introduce brief warning buffer (1 second) to ensure warning is read
    await new Promise((resolve) => setTimeout(resolve, 1000));

    await ctx.reply(
      `⏳ <b>Powering off server</b> <code>${alias}</code> (${server.provider.toUpperCase()})...`,
      'HTML',
    );

    const provider = ctx.providerRegistry.getProvider(server.provider);
    await provider.stopServer(server.id, server.region);

    await ctx.reply(
      `✅ <b>Stop command issued successfully</b>\nServer <code>${alias}</code> is powering down. Run /status to verify state changes.`,
      'HTML',
    );
  }
}
