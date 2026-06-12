import { TelegramContext } from '../../types';
import { CommandHandler } from './CommandHandler';
import { MessageRenderer } from '../MessageRenderer';

export class DockerHandler implements CommandHandler {
  public readonly name = 'docker';
  public readonly description = 'Container inventory — running, unhealthy, state per server';

  public async execute(ctx: TelegramContext): Promise<void> {
    const kv = ctx.monitoringKv;
    if (!kv) { await ctx.reply(MessageRenderer.configError('MONITORING_KV'), 'HTML'); return; }

    const aliases = ctx.serverRegistry.getAliases();
    let report = '';

    for (const alias of aliases) {
      const raw = await kv.get(`metrics:${alias.toLowerCase()}`);
      if (!raw) { report += MessageRenderer.emptyCard(alias); continue; }

      try {
        interface M { docker?: { running: number; total: number; unhealthy: number;
          containers?: Array<{ name: string; status: string; state: string }>; }; }
        const m = JSON.parse(raw) as M;
        const d = m.docker;
        if (!d) { report += MessageRenderer.emptyCard(alias); continue; }

        report += MessageRenderer.dockerCard(
          alias, d.running, d.total, d.unhealthy, d.containers || [],
        );
      } catch {
        report += MessageRenderer.emptyCard(alias);
      }
    }

    await ctx.reply(report, 'HTML');
  }
}
