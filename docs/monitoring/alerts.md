# Bandwidth Alerts & Thresholds

The Control Plane proactively tracks monthly cumulative network transit and alerts operators when bandwidth utilization hits warning stages.

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
