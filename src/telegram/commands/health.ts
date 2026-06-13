import { TelegramContext } from '../../types';
import { CommandHandler } from './CommandHandler';
import { MessageRenderer } from '../MessageRenderer';

export class HealthHandler implements CommandHandler {
  public readonly name = 'health';
  public readonly description = 'Control Plane diagnostics — bindings, providers, environment';

  public async execute(ctx: TelegramContext): Promise<void> {
    const activeProviders = ctx.providerRegistry.getActiveProviders().map((p) => p.name);

    const kv = ctx.monitoringKv;
    const kvStatus = kv ? 'Bound' : 'Unbound';

    let latestTs = 0;
    if (kv) {
      const aliases = ctx.serverRegistry.getAliases();
      const raws = await Promise.all(
        aliases.map((alias) => kv.get(`metrics:${alias.toLowerCase()}`)),
      );
      for (const raw of raws) {
        if (raw) {
          try {
            const parsed = JSON.parse(raw) as { timestamp: number };
            if (parsed.timestamp > latestTs) latestTs = parsed.timestamp;
          } catch { /* skip malformed JSON */ }
        }
      }
    }
    await ctx.reply(
      MessageRenderer.healthDashboard(
        kvStatus,
        activeProviders.length > 0 ? `${activeProviders.join(', ')} Connected` : 'None',
        ctx.env.AWS_REGION,
        ctx.env.NODE_ENV,
        ctx.env.AUTHORIZED_USER_IDS.length,
        latestTs,
      ),
      'HTML',
    );
  }
}
