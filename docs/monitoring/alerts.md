# Bandwidth Alerts & Thresholds

The Control Plane proactively tracks monthly cumulative network transit and alerts operators when bandwidth utilization hits warning stages.

## Setup

Alerts are automatic once the agent is running.

**Prerequisites:**
1. `MONITORING_KV` KV namespace bound to the worker
2. `MONITORING_SECRET` set on both the worker and the agent config file (`/etc/infra-agent.conf`)
3. Agent cron job running every 5 minutes (see [Agent Setup](../monitoring/agent.md))
4. `vnstat` installed on the target server
   ```bash
   sudo apt install vnstat   # Debian/Ubuntu
   sudo yum install vnstat   # CentOS/RHEL
   ```

## Configuring Thresholds

Bandwidth alerts are disabled by default. To receive alerts, you must configure a threshold for each server using Telegram:

1. Send `/setbandwidth` to the bot.
2. Select the target server.
3. Click a predefined threshold value (**50 GB**, **80 GB**, **100 GB**) or choose **Remove Threshold** to disable alerts.
4. Alternatively, use the direct command: `/setbandwidth <alias> <GB>` or `/setbandwidth <alias> remove`.

Once a threshold is set via Telegram (stored in `MONITORING_KV` at key `bandwidth_limit:<alias>`), the Control Plane will check telemetry posts and alert operators if the monthly bandwidth usage exceeds that threshold. If no threshold is set, no bandwidth alerts are sent.

## Deduplication Logic

To prevent flooding operator chats with duplicate warnings during consecutive agent posts, the Worker enforces monthly state tracking:

1. **Identifier Key**: Alerts utilize a composite key tracking the server name, the target threshold, and the current month:
   ```text
   alert:<server_alias>:<threshold_gb>:<yyyy-mm>
   ```
2. **Deduplication Check**:
   ```typescript
   const isSent = await kv.get(alertKey);
   if (!isSent) {
     await kv.put(alertKey, 'true', { expirationTtl: 30 * 24 * 3600 });
     await sendTelegramAlert(...);
   }
   ```
3. **Automatic Expiry**: The keys are configured with a `30-day` time-to-live (TTL), guaranteeing cleanup and automatic resets when the calendar month rolls over.
