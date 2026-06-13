import { TelegramContext } from '../../types';
import { CommandHandler } from './CommandHandler';
import { MessageRenderer } from '../MessageRenderer';

const KV_PREFIX = 'bandwidth_limit:';

export class SetBandwidthHandler implements CommandHandler {
  public readonly name = 'setbandwidth';
  public readonly description = 'Set bandwidth alert threshold per server — override env config. Use "remove" to clear.';

  public async execute(ctx: TelegramContext): Promise<void> {
    const kv = ctx.monitoringKv;
    if (!kv) { await ctx.reply(MessageRenderer.configError('MONITORING_KV'), 'HTML'); return; }

    let alias = ctx.args[0];
    let valueRaw = ctx.args[1];

    // Check if argument came from callback query formatted as "alias:value"
    if (alias && alias.includes(':')) {
      const parts = alias.split(':');
      alias = parts[0];
      valueRaw = parts[1];
    }

    if (!alias) {
      await ctx.reply(
        MessageRenderer.error(this.name, 'missing alias', 'Usage: /setbandwidth &lt;alias&gt; &lt;GB&gt; or /setbandwidth &lt;alias&gt; remove'),
        'HTML',
      );
      return;
    }

    const server = ctx.serverRegistry.getServer(alias);
    if (!server) { await ctx.reply(MessageRenderer.notFound(alias), 'HTML'); return; }

    if (!valueRaw) {
      // Prompt for threshold selection using inline keyboard
      const inlineKeyboard = [
        [
          { text: '50 GB', callback_data: `setbandwidth:${alias}:50` },
          { text: '80 GB', callback_data: `setbandwidth:${alias}:80` },
          { text: '100 GB', callback_data: `setbandwidth:${alias}:100` },
        ],
        [
          { text: 'Remove Threshold', callback_data: `setbandwidth:${alias}:remove` }
        ]
      ];

      await ctx.reply(
        `<b>Set Bandwidth Alert Threshold: ${MessageRenderer.raw(alias)}</b>\n\n` +
        'Select a threshold value or choose \'Remove\' to clear:',
        'HTML',
        { inline_keyboard: inlineKeyboard }
      );
      return;
    }

    valueRaw = valueRaw.toLowerCase();
    const key = `${KV_PREFIX}${alias.toLowerCase()}`;

    if (valueRaw === 'remove') {
      await kv.delete(key);
      await ctx.reply(MessageRenderer.success('Bandwidth alert threshold removed', alias, {
        'Fallback': server.bandwidthLimitGB ? `${server.bandwidthLimitGB} GB (env)` : 'No threshold',
      }), 'HTML');
      return;
    }

    const gb = parseFloat(valueRaw);
    if (isNaN(gb) || gb <= 0) {
      await ctx.reply(
        MessageRenderer.error(this.name, alias, 'Threshold must be a positive number in GB, or "remove".'),
        'HTML',
      );
      return;
    }

    await kv.put(key, gb.toString());
    await ctx.reply(MessageRenderer.success('Bandwidth alert threshold set', alias, {
      'Threshold': `${gb} GB`,
      'Fallback': server.bandwidthLimitGB ? `${server.bandwidthLimitGB} GB (env)` : 'None',
    }), 'HTML');
  }
}
