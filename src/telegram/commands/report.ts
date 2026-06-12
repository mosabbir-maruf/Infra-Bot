import { TelegramContext } from '../../types';
import { CommandHandler } from './CommandHandler';
import { MessageRenderer } from '../MessageRenderer';

export class ReportHandler implements CommandHandler {
  public readonly name = 'report';
  public readonly description = 'Retrieves a health and metrics summary of managed VPS servers';

  public async execute(ctx: TelegramContext): Promise<void> {
    const kv = (ctx.env as unknown as Record<string, unknown>).MONITORING_KV as {
      get(key: string): Promise<string | null>;
    } | null;

    if (!kv) {
      await ctx.reply(MessageRenderer.configError('MONITORING_KV'), 'HTML');
      return;
    }

    const aliases = ctx.serverRegistry.getAliases();
    if (aliases.length === 0) {
      await ctx.reply(MessageRenderer.noServers(), 'HTML');
      return;
    }

    let report = '';
    let activeCount = 0;

    for (const alias of aliases) {
      const data = await kv.get(`metrics:${alias.toLowerCase()}`);
      if (!data) {
        report += MessageRenderer.serverMetrics(alias, {
          'Status': 'No telemetry data',
        });
        report += '\n';
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

        let status = 'Active';
        if (ageMinutes > 15) {
          status = 'Stale';
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

        report += MessageRenderer.serverMetrics(alias, {
          'Status': status,
          'CPU': `${metrics.cpu}%`,
          'Uptime': uptimeStr,
          'RAM': `${ramUsedGB} GB / ${ramTotalGB} GB`,
          'Disk': `${diskUsedGB} GB / ${diskTotalGB} GB`,
          'Containers': `${dockerRun}/${dockerTot}`,
        });
        report += '\n';
      } catch {
        report += MessageRenderer.serverMetrics(alias, {
          'Status': 'Corrupted telemetry data',
        });
        report += '\n';
      }
    }

    const summary = `${activeCount} / ${aliases.length} active nodes.`;
    report += MessageRenderer.header('Summary');
    report += `\n${summary}\n`;

    await ctx.reply(report, 'HTML');
  }
}
