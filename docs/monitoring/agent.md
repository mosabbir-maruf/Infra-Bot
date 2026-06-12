# Monitoring Agent Installation & Setup

The VPS monitoring agent is a portable, dependency-free Bash script that queries native Linux subsystem logs and daemon CLIs.

## Requirements & Prerequisites

The agent relies on standard Linux utilities. Ensure the following tools are installed:
* `bash`, `curl`, `awk` (standard on all systems).
* `openssl` (for HMAC signing).
* `docker` (optional, to query container count and health status).
* `vnstat` (required for monthly bandwidth tracking).

### Installing vnStat
Install vnStat via your package manager:
```bash
# Debian / Ubuntu
sudo apt-get update
sudo apt-get install -y vnstat vnstati

# CentOS / RHEL / Rocky Linux
sudo dnf install -y epel-release
sudo dnf install -y vnstat
```
*Note: Ensure the vnStat daemon is started and enabled:*
```bash
sudo systemctl enable --now vnstat
```

---

## Installation Steps

1. Copy the script to `/usr/local/bin/infra-agent.sh` and make it executable:
   ```bash
   sudo cp monitoring/agent.sh /usr/local/bin/infra-agent.sh
   sudo chmod +x /usr/local/bin/infra-agent.sh
   ```
2. Create the configuration file `/etc/infra-agent.conf` with `sudo nano` and paste the following (replace with your values):
    ```bash
   SERVER_ALIAS="ai-gateway-prod"
   MONITORING_SECRET="your_shared_hmac_secret"
   CONTROL_PLANE_URL="https://your-worker.workers.dev"
   ```

---

## Cron Orchestration

Configure a cron job to run the agent every 5 minutes:

1. Open crontab editor:
   ```bash
   sudo crontab -e
   ```
2. Add the following line:
   ```cron
   */5 * * * * . /etc/infra-agent.conf; export SERVER_ALIAS MONITORING_SECRET CONTROL_PLANE_URL; /usr/local/bin/infra-agent.sh >/dev/null 2>&1
   ```
3. Save and close. The agent will now execute every 5 minutes, capturing load metrics and piping them securely to the Cloudflare Worker.
