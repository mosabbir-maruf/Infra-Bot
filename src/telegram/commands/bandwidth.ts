import { TelegramContext } from '../../types';
import { CommandHandler } from './CommandHandler';
import { MessageRenderer } from '../MessageRenderer';

export class BandwidthHandler implements CommandHandler {
  public readonly name = 'bandwidth';
  public readonly description = 'Shows monthly bandwidth usage metrics from telemetry store';

  public async execute(ctx: TelegramContext): Promise<void> {
    const kv = ctx.monitoringKv;

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
          bandwidth?: { rx: number; tx: number };
        }
        const metrics = JSON.parse(data) as MetricsPayload;
        const rx = metrics.bandwidth?.rx || 0;
        const tx = metrics.bandwidth?.tx || 0;
        const totalB = rx + tx;

        const rxGB = (rx / (1024 * 1024 * 1024)).toFixed(2);
        const txGB = (tx / (1024 * 1024 * 1024)).toFixed(2);
        const totalGB = (totalB / (1024 * 1024 * 1024)).toFixed(2);

        report += MessageRenderer.serverMetrics(alias, {
          'Total': `${totalGB} GB`,
          'RX': `${rxGB} GB`,
          'TX': `${txGB} GB`,
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
