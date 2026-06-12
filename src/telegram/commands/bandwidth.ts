import { TelegramContext } from '../../types';
import { CommandHandler } from './CommandHandler';

export class BandwidthHandler implements CommandHandler {
  public readonly name = 'bandwidth';
  public readonly description = 'Shows monthly bandwidth usage metrics from telemetry store';

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

    let report = '📈 <b>Monthly Bandwidth Usage Report</b>\n\n';

    for (const alias of aliases) {
      const data = await kv.get(`metrics:${alias.toLowerCase()}`);
      if (!data) {
        report += `• <b>${alias}</b>: <i>No telemetry recorded</i>\n\n`;
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

        // Render progress bar (reference limit: 100 GB)
        const limitGB = 100;
        const percent = Math.min(Math.floor((parseFloat(totalGB) / limitGB) * 10), 10);
        let bar = '';
        for (let i = 0; i < 10; i++) {
          bar += i < percent ? '■' : '□';
        }
        const pctLabel = Math.min(Math.floor((parseFloat(totalGB) / limitGB) * 100), 100);

        report += `• <b>${alias}</b>: <b>${totalGB} GB</b> (rx: <code>${rxGB} GB</code> | tx: <code>${txGB} GB</code>)\n  <code>${bar}</code> [${pctLabel}% of 100GB]\n\n`;
      } catch {
        report += `• <b>${alias}</b>: <i>Corrupted data</i>\n\n`;
      }
    }

    await ctx.reply(report, 'HTML');
  }
}
