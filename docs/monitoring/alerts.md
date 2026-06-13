# Bandwidth Alerts & Thresholds

The Control Plane proactively tracks monthly cumulative network transit and alerts operators when bandwidth utilization hits warning stages.

## Setup

Alerts are automatic once the agent is running. No additional configuration is needed.

**Prerequisites:**
1. `MONITORING_KV` KV namespace bound to the worker
2. `MONITORING_SECRET` set on both the worker and the agent config file (`/etc/infra-agent.conf`)
3. Agent cron job running every 5 minutes (see [Agent Setup](../monitoring/agent.md))
4. `vnstat` installed on the target server
   ```bash
   sudo apt install vnstat   # Debian/Ubuntu
   sudo yum install vnstat   # CentOS/RHEL
   ```

**Custom per-server quota:** Add `"bandwidthLimitGB": 200` to a server entry in `SERVERS_CONFIG`. The `/bandwidth` Telegram command will render a progress bar against that limit. This is optional — alerts still fire at the hardcoded thresholds regardless.

## Threshold Levels

Warnings are dispatched to authorized Telegram chats at the following stages:
* ⚠️ **Warning Stage 1**: `50 GB` of traffic
* 🟠 **Warning Stage 2**: `80 GB` of traffic
* 🚨 **Critical Stage 3**: `95 GB` of traffic

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
