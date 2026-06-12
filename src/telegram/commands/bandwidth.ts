import { TelegramContext } from '../../types';
import { CommandHandler } from './CommandHandler';
import { MessageRenderer } from '../MessageRenderer';

export class BandwidthHandler implements CommandHandler {
  public readonly name = 'bandwidth';
  public readonly description = 'Monthly bandwidth — RX, TX, total with progress bars';

  public async execute(ctx: TelegramContext): Promise<void> {
    const kv = ctx.monitoringKv;
    if (!kv) { await ctx.reply(MessageRenderer.configError('MONITORING_KV'), 'HTML'); return; }

    const aliases = ctx.serverRegistry.getAliases();
    if (aliases.length === 0) { await ctx.reply(MessageRenderer.noServers(), 'HTML'); return; }

    let report = '';
    for (const alias of aliases) {
      const raw = await kv.get(`metrics:${alias.toLowerCase()}`);
      if (!raw) { report += MessageRenderer.emptyCard(alias); continue; }

      try {
        interface M { timestamp: number; bandwidth?: { rx: number; tx: number }; }
        const m = JSON.parse(raw) as M;
        report += MessageRenderer.bandwidthCard(
          alias, m.timestamp, m.bandwidth?.rx || 0, m.bandwidth?.tx || 0,
        );
      } catch {
        report += MessageRenderer.emptyCard(alias);
      }
    }

    await ctx.reply(report, 'HTML');
  }
}
