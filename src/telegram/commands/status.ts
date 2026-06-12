import { TelegramContext } from '../../types';
import { CommandHandler } from './CommandHandler';

export class StatusHandler implements CommandHandler {
  public readonly name = 'status';
  public readonly description =
    'Lists status of all registered servers or queries details for a specific server';

  public async execute(ctx: TelegramContext): Promise<void> {
    // 1. Detailed Query for a Single Server Alias: /status <server_alias>
    if (ctx.args.length >= 1) {
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
        `🔍 Querying metadata for server <code>${alias}</code> (${server.provider.toUpperCase()})...`,
        'HTML',
      );

      const provider = ctx.providerRegistry.getProvider(server.provider);
      const status = await provider.getServerStatus(server.id, server.region);
      const meta = await provider.getInstanceMetadata(server.id, server.region);

      const statusEmoji =
        status.status === 'running'
          ? '🟢'
          : status.status === 'starting'
            ? '🟡'
            : status.status === 'stopping'
              ? '🟡'
              : status.status === 'stopped'
                ? '🔴'
                : status.status === 'terminated'
                  ? '💀'
                  : '⚪';

      const details = `🖥️ <b>Server Detailed Telemetry: ${alias}</b>
• <b>Provider:</b> <code>${provider.name}</code>
• <b>Instance ID:</b> <code>${meta.instanceId}</code>
• <b>Instance Type:</b> <code>${meta.instanceType}</code>
• <b>AZ / Zone:</b> <code>${meta.availabilityZone || 'N/A'}</code>
• <b>Status:</b> ${statusEmoji} <code>${status.status}</code> (State: <code>${meta.state}</code>)
• <b>Public IP:</b> <code>${meta.publicIp || 'N/A'}</code>
• <b>Private IP:</b> <code>${meta.privateIp || 'N/A'}</code>`;

      await ctx.reply(details, 'HTML');
      return;
    }

    // 2. Aggregate Status for all servers in ServerRegistry
    const allServers = ctx.serverRegistry.getAllServers();
    if (allServers.length === 0) {
      await ctx.reply(
        '⚠️ <b>No servers are registered.</b> Please configure SERVERS_CONFIG.',
        'HTML',
      );
      return;
    }

    await ctx.reply('🔍 Resolving infrastructure status...', 'HTML');

    // Fetch all statuses concurrently
    const results = await Promise.all(
      allServers.map(async (server) => {
        try {
          const provider = ctx.providerRegistry.getProvider(server.provider);
          const status = await provider.getServerStatus(server.id, server.region);
          return { alias: server.alias, success: true, status };
        } catch (err) {
          return { alias: server.alias, success: false, error: err };
        }
      }),
    );

    let report = '🖥️ <b>Infrastructure Status Report</b>\n\n';

    for (const res of results) {
      if (!res.success) {
        const errMsg = res.error instanceof Error ? res.error.message : String(res.error);
        report += `❌ <b>${res.alias}</b>: <i>Error: ${errMsg}</i>\n`;
        continue;
      }

      const s = res.status!;
      const emoji =
        s.status === 'running'
          ? '🟢'
          : s.status === 'starting'
            ? '🟡'
            : s.status === 'stopping'
              ? '🟡'
              : s.status === 'stopped'
                ? '🔴'
                : s.status === 'terminated'
                  ? '💀'
                  : '⚪';

      report += `${emoji} <b>${res.alias}</b> (IP: <code>${s.ipAddress || 'N/A'}</code>) - <code>${s.status}</code>\n  Id: <code>${s.id}</code> | Region: <code>${s.region}</code>\n`;
    }

    await ctx.reply(report, 'HTML');
  }
}
