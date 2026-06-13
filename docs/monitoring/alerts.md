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

Set the `BANDWIDTH_ALERT_THRESHOLDS` environment variable as a comma-separated list of GB values:

```
npx wrangler secret put BANDWIDTH_ALERT_THRESHOLDS
```

Enter a value like `100,200,500`. If not set, the worker defaults to `50,80,95`.

**Optional — `bandwidthLimitGB`:** Adding `"bandwidthLimitGB": 500` to a server entry in `SERVERS_CONFIG` only adds a progress bar to the `/bandwidth` Telegram command. Without it, you see raw GB numbers. The threshold alerts fire regardless.

**Runtime override:** Use `/setbandwidth <alias> <GB>` via Telegram to set a per-server limit that takes precedence over `bandwidthLimitGB` in `SERVERS_CONFIG`. Use `/setbandwidth <alias> remove` to clear the override and fall back to the env config. The limit is stored in `MONITORING_KV` at key `bandwidth_limit:<alias>`.

## Deduplication Logic

To prevent flooding operator chats with duplicate warnings during consecutive agent posts, the Worker enforces monthly state tracking:

1. **Identifier Key**: Alerts utilize a composite key tracking the server name, the target limit, and the current month:
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
