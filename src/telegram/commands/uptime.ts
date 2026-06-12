import { TelegramContext } from '../../types';
import { CommandHandler } from './CommandHandler';
import { MessageRenderer } from '../MessageRenderer';

export class UptimeHandler implements CommandHandler {
  public readonly name = 'uptime';
  public readonly description = 'Checks system uptime and telemetry age of paired VPS instances';

  public async execute(ctx: TelegramContext): Promise<void> {
    const kv = ctx.monitoringKv;

    if (!kv) {
      await ctx.reply(MessageRenderer.configError('MONITORING_KV'), 'HTML');
      return;
    }

    const aliases = ctx.serverRegistry.getAliases();
    let report = '';

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
          uptime: number;
          cpu: string;
        }
        const metrics = JSON.parse(data) as MetricsPayload;

        const days = Math.floor(metrics.uptime / (24 * 3600));
        const hours = Math.floor((metrics.uptime % (24 * 3600)) / 3600);
        const minutes = Math.floor((metrics.uptime % 3600) / 60);

        let uptimeStr = '';
        if (days > 0) uptimeStr += `${days}d `;
        if (hours > 0) uptimeStr += `${hours}h `;
        uptimeStr += `${minutes}m`;

        const lastSeen = new Date(metrics.timestamp * 1000);
        const ageMinutes = Math.floor((Date.now() - lastSeen.getTime()) / (1000 * 60));
        const status = ageMinutes > 15 ? `Stale (${ageMinutes}m)` : 'Active';

        report += MessageRenderer.serverMetrics(alias, {
          'Uptime': uptimeStr,
          'Status': status,
          'CPU Load': `${metrics.cpu}%`,
        });
        report += '\n';
      } catch {
        report += MessageRenderer.serverMetrics(alias, {
          'Status': 'Corrupted telemetry data',
        });
        report += '\n';
      }
    }

    await ctx.reply(report, 'HTML');
  }
}
