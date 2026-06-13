import { TelegramContext } from '../../types';
import { CommandHandler } from './CommandHandler';
import { MessageRenderer } from '../MessageRenderer';

export class DockerHandler implements CommandHandler {
  public readonly name = 'docker';
  public readonly description = 'Container inventory — running, unhealthy, state per server';

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
    const cards: string[] = [];
    const raws = await Promise.all(
      aliases.map((alias) => kv.get(`metrics:${alias.toLowerCase()}`)),
    );

    for (let i = 0; i < aliases.length; i++) {
      const alias = aliases[i];
      const raw = raws[i];
      if (!raw) { cards.push(MessageRenderer.emptyCard(alias)); continue; }

      try {
        interface M { timestamp: number; docker?: { running: number; total: number; unhealthy: number;
          containers?: Array<{ name: string; status: string; state: string }>; }; }
        const m = JSON.parse(raw) as M;
        const d = m.docker;
        if (!d) { cards.push(MessageRenderer.emptyCard(alias)); continue; }

        cards.push(MessageRenderer.dockerCard(
          alias, d.running, d.total, d.unhealthy, d.containers || [], m.timestamp,
        ));
      } catch {
        cards.push(MessageRenderer.emptyCard(alias));
      }
    }

    await ctx.reply(cards.join('\n\n───\n\n'), 'HTML');
  }
}
