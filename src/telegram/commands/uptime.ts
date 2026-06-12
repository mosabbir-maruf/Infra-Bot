import { TelegramContext } from '../../types';
import { CommandHandler } from './CommandHandler';
import { MessageRenderer } from '../MessageRenderer';

export class UptimeHandler implements CommandHandler {
  public readonly name = 'uptime';
  public readonly description = 'System uptime and telemetry freshness per server';

  public async execute(ctx: TelegramContext): Promise<void> {
    const kv = ctx.monitoringKv;
    if (!kv) { await ctx.reply(MessageRenderer.configError('MONITORING_KV'), 'HTML'); return; }

    const aliases = ctx.serverRegistry.getAliases();
    let report = '';

    for (const alias of aliases) {
      const raw = await kv.get(`metrics:${alias.toLowerCase()}`);
      if (!raw) { report += MessageRenderer.emptyCard(alias); continue; }

      try {
        interface M { timestamp: number; uptime: number; cpu: string; }
        const m = JSON.parse(raw) as M;
        report += MessageRenderer.uptimeCard(alias, m.timestamp, m.uptime, m.cpu);
      } catch {
        report += MessageRenderer.emptyCard(alias);
      }
    }

    await ctx.reply(report, 'HTML');
  }
}
