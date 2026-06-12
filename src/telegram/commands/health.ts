import { TelegramContext } from '../../types';
import { CommandHandler } from './CommandHandler';
import { MessageRenderer } from '../MessageRenderer';
import { ProviderRegistry } from '../../providers/ProviderRegistry';

export class HealthHandler implements CommandHandler {
  public readonly name = 'health';
  public readonly description = 'Control Plane diagnostics — bindings, providers, environment';

  public async execute(ctx: TelegramContext): Promise<void> {
    const registry = new ProviderRegistry(ctx.env);
    const activeProviders = registry.getActiveProviders().map((p) => p.name);

    const kv = ctx.monitoringKv;
    const kvStatus = kv ? 'Bound' : 'Not Bound';

    await ctx.reply(
      MessageRenderer.healthDashboard(
        kvStatus,
        activeProviders.length > 0 ? activeProviders.join(', ') : 'None',
        ctx.env.AWS_REGION,
        ctx.env.NODE_ENV,
        ctx.env.AUTHORIZED_USER_IDS.length,
      ),
      'HTML',
    );
  }
}
