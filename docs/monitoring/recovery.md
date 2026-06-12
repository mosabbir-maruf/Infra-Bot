# Monitoring Recovery & Troubleshooting

This playbook details operational resolutions for agent telemetry failures, clock drift, key compromise, and daemon corruption.

## Common Failures & Mitigations

### 1. Ingestion Error: Clock Drift (HTTP 400)
* **Symptom**: Ingestion endpoint logs `Rejected report due to clock drift`.
* **Reason**: The VPS system clock is out of sync with international NTP servers by more than 5 minutes.
* **Resolution**:
  Sync the target server clock manually:
  ```bash
  sudo systemctl restart systemd-timesyncd
  # Verify sync status
  timedatectl status
  ```

### 2. Telemetry Staleness (🔴 Stale in bot output)
* **Symptom**: Commands show status as `Stale` or `Offline`.
* **Reason**: The cron agent script has stopped executing or is blocked from reaching the Worker.
* **Resolution**:
  1. SSH into the target VPS.
  2. Verify cron logs:
     ```bash
     grep CRON /var/log/syslog
     ```
  3. Execute the script manually and check response:
     ```bash
     . /etc/infra-agent.conf; export SERVER_ALIAS MONITORING_SECRET CONTROL_PLANE_URL; /usr/local/bin/infra-agent.sh
     ```
  4. Ensure target port outbound traffic is not blocked by external cloud firewalls.

---

## Shared Secret Rotation

If the `MONITORING_SECRET` is compromised, rotate it immediately:

1. Generate a new cryptographically secure random string:
   ```bash
   openssl rand -hex 24
   ```
2. Update the secret in Cloudflare:
   ```bash
   npx wrangler secret put MONITORING_SECRET
   ```
3. Update the configuration file on all managed servers:
   Modify `/etc/infra-agent.conf`:
   ```bash
   MONITORING_SECRET="new_secret_key"
   ```
4. Confirm reports succeed by tailing Cloudflare logs:
   ```bash
   npx wrangler tail
   ```
