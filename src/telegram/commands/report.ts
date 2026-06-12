import { TelegramContext } from '../../types';
import { CommandHandler } from './CommandHandler';

export class ReportHandler implements CommandHandler {
  public readonly name = 'report';
  public readonly description = 'Retrieves a health and metrics summary of managed VPS servers';

  public async execute(ctx: TelegramContext): Promise<void> {
    const kv = (ctx.env as unknown as Record<string, unknown>).MONITORING_KV as {
      get(key: string): Promise<string | null>;
    } | null;

    if (!kv) {
      await ctx.reply('⚠️ <b>Error:</b> MONITORING_KV binding is not configured.', 'HTML');
      return;
    }

    const aliases = ctx.serverRegistry.getAliases();
    if (aliases.length === 0) {
      await ctx.reply('⚠️ <b>No servers are registered.</b>', 'HTML');
      return;
    }

    let report = '📊 <b>Infrastructure Metrics Dashboard</b>\n\n';
    let activeCount = 0;

    for (const alias of aliases) {
      const data = await kv.get(`metrics:${alias.toLowerCase()}`);
      if (!data) {
        report += `⚪ <b>${alias}</b>: No telemetry data available.\n\n`;
        continue;
      }

      try {
        interface MetricsPayload {
          timestamp: number;
          cpu: string;
          ram: { total: number; used: number };
          disk: { total: number; used: number };
          uptime: number;
          docker?: { running: number; total: number };
        }

        const metrics = JSON.parse(data) as MetricsPayload;
        const lastSeen = new Date(metrics.timestamp * 1000);
        const ageMinutes = (Date.now() - lastSeen.getTime()) / (1000 * 60);

        let statusEmoji = '🟢';
        if (ageMinutes > 15) {
          statusEmoji = '🔴 (Stale)';
        } else {
          activeCount++;
        }

        const ramUsedGB = (metrics.ram.used / 1024).toFixed(2);
        const ramTotalGB = (metrics.ram.total / 1024).toFixed(2);
        const diskUsedGB = (metrics.disk.used / 1024).toFixed(2);
        const diskTotalGB = (metrics.disk.total / 1024).toFixed(2);

        const days = Math.floor(metrics.uptime / (24 * 3600));
        const hours = Math.floor((metrics.uptime % (24 * 3600)) / 3600);
        const uptimeStr = days > 0 ? `${days}d ${hours}h` : `${hours}h`;

        const dockerRun = metrics.docker?.running || 0;
        const dockerTot = metrics.docker?.total || 0;

        report += `${statusEmoji} <b>${alias}</b>
• <b>CPU:</b> <code>${metrics.cpu}%</code> | <b>Uptime:</b> <code>${uptimeStr}</code>
• <b>RAM:</b> <code>${ramUsedGB} GB / ${ramTotalGB} GB</code>
• <b>Disk:</b> <code>${diskUsedGB} GB / ${diskTotalGB} GB</code>
• <b>Docker:</b> <code>${dockerRun}/${dockerTot} containers</code>\n\n`;
      } catch {
        report += `⚠️ <b>${alias}</b>: Corrupted telemetry data.\n\n`;
      }
    }

    report += `Summary: ${activeCount} / ${aliases.length} active nodes.`;

    await ctx.reply(report, 'HTML');
  }
}
