import { TelegramContext } from '../../types';
import { CommandHandler } from './CommandHandler';

export class UptimeHandler implements CommandHandler {
  public readonly name = 'uptime';
  public readonly description = 'Checks system uptime and telemetry age of paired VPS instances';

  public async execute(ctx: TelegramContext): Promise<void> {
    const kv = (ctx.env as unknown as Record<string, unknown>).MONITORING_KV as {
      get(key: string): Promise<string | null>;
    } | null;

    if (!kv) {
      await ctx.reply('⚠️ <b>Error:</b> MONITORING_KV binding is not configured.', 'HTML');
      return;
    }

    const aliases = ctx.serverRegistry.getAliases();
    let report = '⏱️ <b>VPS System Uptime Telemetry</b>\n\n';

    for (const alias of aliases) {
      const data = await kv.get(`metrics:${alias.toLowerCase()}`);
      if (!data) {
        report += `• <b>${alias}</b>: <i>No telemetry recorded</i>\n\n`;
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
        const statusStr = ageMinutes > 15 ? `🔴 (Stale: ${ageMinutes}m)` : '🟢 (Active)';

        report += `• <b>${alias}</b>: <code>${uptimeStr}</code> | Uptime Status: ${statusStr}
  Avg CPU Load: <code>${metrics.cpu}%</code>\n\n`;
      } catch {
        report += `• <b>${alias}</b>: <i>Corrupted data</i>\n\n`;
      }
    }

    await ctx.reply(report, 'HTML');
  }
}
