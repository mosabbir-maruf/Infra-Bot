import { TelegramContext } from '../../types';
import { CommandHandler } from './CommandHandler';

export class StartHandler implements CommandHandler {
  public readonly name = 'start';
  public readonly description = 'Welcome message or starts a stopped server instance';

  public async execute(ctx: TelegramContext): Promise<void> {
    if (ctx.args.length === 0) {
      const welcomeMessage = `👋 **Welcome to the Mosabbir Infrastructure Bot!**

You are authenticated with the Infrastructure Control Plane.

Core Operations:
• Run /status to check status of all instances
• Run /help to view the full command menu`;
      await ctx.reply(welcomeMessage, 'Markdown');
      return;
    }

    const alias = ctx.args[0];
    const server = ctx.serverRegistry.getServer(alias);

    if (!server) {
      await ctx.reply(`⚠️ <b>Error:</b> Server alias <code>${alias}</code> not found in the registry.`, 'HTML');
      return;
    }

    await ctx.reply(`⏳ <b>Starting server</b> <code>${alias}</code> (${server.provider.toUpperCase()})...`, 'HTML');

    const provider = ctx.providerRegistry.getProvider(server.provider);
    await provider.startServer(server.id, server.region);

    await ctx.reply(
      `✅ <b>Start command issued successfully</b>\nServer <code>${alias}</code> is starting. Run /status to verify state changes.`,
      'HTML',
    );
  }
}
