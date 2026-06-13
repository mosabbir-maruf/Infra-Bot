import { TelegramContext } from '../../types';
import { CommandHandler } from './CommandHandler';
import { MessageRenderer } from '../MessageRenderer';

export class HelpHandler implements CommandHandler {
  public readonly name = 'help';
  public readonly description = 'Shows available commands and usage guidelines';

  public async execute(ctx: TelegramContext): Promise<void> {
    const commands = [
      { command: '/help', description: 'Show available commands.' },
      { command: '/status', description: 'Display current status of all servers.', args: '<server>' },
      { command: '/health', description: 'Check control plane and provider health.' },
      { command: '/start', description: 'Start a stopped server.', args: '<server>' },
      { command: '/stop', description: 'Stop a running server.', args: '<server>' },
      { command: '/reboot', description: 'Reboot a server.', args: '<server>' },
      { command: '/report', description: 'View metrics summary for all servers.' },
      { command: '/bandwidth', description: 'View bandwidth usage details.' },
      { command: '/setbandwidth', description: 'Set bandwidth limit per server.', args: '<alias> <GB|remove>' },
      { command: '/docker', description: 'View Docker container status.' },
      { command: '/uptime', description: 'View system uptime details.' },
    ];

    await ctx.reply(MessageRenderer.help(commands), 'HTML');
  }
}
