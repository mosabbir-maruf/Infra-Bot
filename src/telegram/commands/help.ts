import { TelegramContext } from '../../types';
import { CommandHandler } from './CommandHandler';

export class HelpHandler implements CommandHandler {
  public readonly name = 'help';
  public readonly description = 'Shows available commands and usage guidelines';

  public async execute(ctx: TelegramContext): Promise<void> {
    const helpMessage = `🤖 **Mosabbir Infrastructure Bot - Help Menu**

Available Commands:
📌 **Information & Health**
• /status \\- View status of all registered cloud servers
• /health \\- Check Control Plane and provider binding health
• /help \\- Show this help menu

⚙️ **Server Operations**
• \`/start <provider> <server_id>\` \\- Start a stopped server
• \`/stop <provider> <server_id>\` \\- Stop a running server
• \`/reboot <provider> <server_id>\` \\- Reboot a server

📊 **Monitoring (Agent Integration)**
• /report \\- Summary report of all managed VPS metrics
• /bandwidth \\- Bandwidth usage details
• /docker \\- Status of Docker containers on VPS
• /uptime \\- VPS system uptime details

_Supported Providers: AWS, DigitalOcean_`;

    await ctx.reply(helpMessage, 'MarkdownV2');
  }
}
