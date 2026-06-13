import { TelegramContext } from '../../types';
import { CommandHandler } from './CommandHandler';
import { MessageRenderer } from '../MessageRenderer';

const KV_PREFIX = 'bandwidth_limit:';

export class SetBandwidthHandler implements CommandHandler {
  public readonly name = 'setbandwidth';
  public readonly description = 'Set bandwidth limit per server — override env config. Use "remove" to clear.';

  public async execute(ctx: TelegramContext): Promise<void> {
    const kv = ctx.monitoringKv;
    if (!kv) { await ctx.reply(MessageRenderer.configError('MONITORING_KV'), 'HTML'); return; }

    const alias = ctx.args[0];
    if (!alias) {
      await ctx.reply(
        MessageRenderer.error(this.name, 'missing alias', 'Usage: /setbandwidth &lt;alias&gt; &lt;GB&gt; or /setbandwidth &lt;alias&gt; remove'),
        'HTML',
      );
      return;
    }

    const server = ctx.serverRegistry.getServer(alias);
    if (!server) { await ctx.reply(MessageRenderer.notFound(alias), 'HTML'); return; }

    if (ctx.args.length < 2) {
      await ctx.reply(
        `<b>Set Bandwidth Limit: ${MessageRenderer.raw(alias)}</b>\n\n` +
        `To set a limit, copy and edit the command below:\n` +
        `<code>/setbandwidth ${MessageRenderer.raw(alias)} 500</code>\n\n` +
        `To remove the limit:\n` +
        `<code>/setbandwidth ${MessageRenderer.raw(alias)} remove</code>`,
        'HTML',
      );
      return;
    }

    const valueRaw = ctx.args[1].toLowerCase();
    const key = `${KV_PREFIX}${alias.toLowerCase()}`;

    if (valueRaw === 'remove') {
      await kv.delete(key);
      await ctx.reply(MessageRenderer.success('Bandwidth limit removed', alias, {
        'Fallback': server.bandwidthLimitGB ? `${server.bandwidthLimitGB} GB (env)` : 'No limit',
      }), 'HTML');
      return;
    }

    const gb = parseFloat(valueRaw);
    if (isNaN(gb) || gb <= 0) {
      await ctx.reply(
        MessageRenderer.error(this.name, alias, 'Limit must be a positive number in GB, or "remove".'),
        'HTML',
      );
      return;
    }

    await kv.put(key, gb.toString());
    await ctx.reply(MessageRenderer.success('Bandwidth limit set', alias, {
      'Limit': `${gb} GB`,
      'Fallback': server.bandwidthLimitGB ? `${server.bandwidthLimitGB} GB (env)` : 'None',
    }), 'HTML');
  }
}
