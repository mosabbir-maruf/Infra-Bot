import { TelegramContext } from '../../types';
import { CommandHandler } from './CommandHandler';
import { MessageRenderer } from '../MessageRenderer';

export class ReportHandler implements CommandHandler {
  public readonly name = 'report';
  public readonly description = 'Full resource telemetry — CPU, RAM, disk, uptime, containers';

  public async execute(ctx: TelegramContext): Promise<void> {
    const kv = ctx.monitoringKv;
    if (!kv) { await ctx.reply(MessageRenderer.configError('MONITORING_KV'), 'HTML'); return; }

    const aliases = ctx.serverRegistry.getAliases();
    if (aliases.length === 0) { await ctx.reply(MessageRenderer.noServers(), 'HTML'); return; }

    const cards: string[] = [];

    for (const alias of aliases) {
      const raw = await kv.get(`metrics:${alias.toLowerCase()}`);
      if (!raw) { cards.push(MessageRenderer.emptyCard(alias)); continue; }

      try {
        interface M { timestamp: number; cpu: string;
          ram: { total: number; used: number }; disk: { total: number; used: number };
          uptime: number; docker?: { running: number; total: number; unhealthy: number }; }
        const m = JSON.parse(raw) as M;

        const cpuPct = parseFloat(m.cpu) || 0;

        cards.push(MessageRenderer.reportCard(
          alias, m.timestamp, m.cpu, cpuPct,
          m.ram.used, m.ram.total, m.disk.used, m.disk.total,
          m.uptime, m.docker?.running, m.docker?.total, m.docker?.unhealthy,
        ));
      } catch {
        cards.push(MessageRenderer.emptyCard(alias));
      }
    }

    await ctx.reply(cards.join('\n\n───\n\n'), 'HTML');
  }
}
