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

1. Create the agent script:
   ```bash
   sudo nano /usr/local/bin/infra-agent.sh
   ```
   Copy the contents of [`monitoring/agent.sh`](https://github.com/mosabbir-maruf/Infra-Bot/blob/main/monitoring/agent.sh) from the repo, paste, and save.

2. Create the configuration file:
   ```bash
   sudo nano /etc/infra-agent.conf
   ```
   Paste the following (replace with your values):
   ```bash
   SERVER_ALIAS="ai-gateway-prod"
   MONITORING_SECRET="your_shared_hmac_secret"
   CONTROL_PLANE_URL="https://your-worker.workers.dev"
   ```
3. Make the script executable:
   ```bash
   sudo chmod +x /usr/local/bin/infra-agent.sh
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
3. Save and close.

**What this does:** Every 5 minutes, your server runs the agent script which collects CPU, RAM, disk, and bandwidth usage, then posts the data to your Cloudflare Worker. Without this cron job, no metrics are collected — the dashboard shows `—` for bandwidth and Telegram commands like `/status` and `/bandwidth` have no data to display.

**Breaking down the command:**
- `*/5 * * * *` — run every 5 minutes, all day, every day
- `. /etc/infra-agent.conf` — load your server alias, secret, and worker URL from the config file
- `export ...` — pass those values to the agent script
- `/usr/local/bin/infra-agent.sh` — the script that collects and sends metrics
- `>/dev/null 2>&1` — discard output to prevent cron from sending you emails
