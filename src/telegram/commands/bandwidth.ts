import { TelegramContext } from '../../types';
import { CommandHandler } from './CommandHandler';
import { MessageRenderer } from '../MessageRenderer';
import { getEffectiveBandwidthLimit } from '../../utils/bandwidth';

export class BandwidthHandler implements CommandHandler {
  public readonly name = 'bandwidth';
  public readonly description = 'Monthly bandwidth — RX, TX, total with progress bars';

  public async execute(ctx: TelegramContext): Promise<void> {
    const kv = ctx.monitoringKv;
    if (!kv) { await ctx.reply(MessageRenderer.configError('MONITORING_KV'), 'HTML'); return; }

    let aliases = ctx.serverRegistry.getAliases();
    if (ctx.args.length >= 1) {
      const alias = ctx.args[0];
      const server = ctx.serverRegistry.getServer(alias);
      if (!server) {
        await ctx.reply(MessageRenderer.notFound(alias), 'HTML');
        return;
      }
      aliases = [alias];
    }
    if (aliases.length === 0) { await ctx.reply(MessageRenderer.noServers(), 'HTML'); return; }

    const cards: string[] = [];
    for (const alias of aliases) {
      const serverConfig = ctx.serverRegistry.getServer(alias);
      const raw = await kv.get(`metrics:${alias.toLowerCase()}`);
      if (!raw) { cards.push(MessageRenderer.emptyCard(alias)); continue; }

      try {
        interface M { timestamp: number; bandwidth?: { rx: number; tx: number }; }
        const m = JSON.parse(raw) as M;
        const effectiveLimit = await getEffectiveBandwidthLimit(kv, alias, serverConfig?.bandwidthLimitGB);
        cards.push(MessageRenderer.bandwidthCard(
          alias, m.timestamp, m.bandwidth?.rx || 0, m.bandwidth?.tx || 0, effectiveLimit,
        ));
      } catch {
        cards.push(MessageRenderer.emptyCard(alias));
      }
    }

    await ctx.reply(cards.join('\n\n───\n\n'), 'HTML');
  }
}
