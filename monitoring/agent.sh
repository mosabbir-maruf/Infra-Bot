#!/usr/bin/env bash

# Infrastructure Bot - VPS Monitoring Agent
# Collects CPU, RAM, Swap, Disk, Uptime, Docker, and vnStat bandwidth metrics,
# signs the payload using HMAC-SHA256, and uploads it to the Control Plane.

set -eo pipefail

# Configuration
SERVER_ALIAS="${SERVER_ALIAS:-}"
MONITORING_SECRET="${MONITORING_SECRET:-}"
CONTROL_PLANE_URL="${CONTROL_PLANE_URL:-}"

if [[ -z "$SERVER_ALIAS" || -z "$MONITORING_SECRET" || -z "$CONTROL_PLANE_URL" ]]; then
  echo "Error: SERVER_ALIAS, MONITORING_SECRET, and CONTROL_PLANE_URL environment variables must be configured."
  exit 1
fi

# 1. CPU Load Calculation (Pure Bash/Awk from /proc/stat)
get_cpu_usage() {
  read -r _ a b c d e f g _ _ < /proc/stat
  prev_total=$((a+b+c+d+e+f+g))
  prev_idle=$((d+e))

  sleep 1

  read -r _ a b c d e f g _ _ < /proc/stat
  total=$((a+b+c+d+e+f+g))
  idle=$((d+e))

  diff_total=$((total-prev_total))
  diff_idle=$((idle-prev_idle))

  if [ "$diff_total" -eq 0 ]; then
    echo "0.0"
  else
    cpu_usage=$(awk "BEGIN {print 100 * ($diff_total - $diff_idle) / $diff_total}")
    printf "%.1f" "$cpu_usage"
  fi
}

# 2. RAM and Swap parsing (free -m)
ram_total=$(free -m | awk '/^Mem:/{print $2}')
ram_used=$(free -m | awk '/^Mem:/{print $3}')
swap_total=$(free -m | awk '/^Swap:/{print $2}')
swap_used=$(free -m | awk '/^Swap:/{print $3}')

# 3. Disk utilisation (df)
disk_total=$(df -m / | awk 'NR==2{print $2}')
disk_used=$(df -m / | awk 'NR==2{print $3}')

# 4. Uptime in seconds (/proc/uptime)
uptime_seconds=$(awk '{print int($1)}' /proc/uptime)

# 5. Docker container states (Docker CLI)
docker_running=0
docker_total=0
docker_unhealthy=0
docker_list="[]"

if command -v docker >/dev/null 2>&1; then
  docker_running=$(docker ps -q | wc -l)
  docker_total=$(docker ps -a -q | wc -l)
  docker_unhealthy=$(docker ps -a --filter "health=unhealthy" -q | wc -l)
  
  # Construct inline JSON list using awk
  docker_list=$(docker ps -a --format '{{.Names}}|{{.Status}}|{{.State}}' | awk -F'|' '
    BEGIN { printf "[" }
    {
      if (NR > 1) printf ", "
      # Escape double quotes in names/statuses
      gsub(/"/, "\\\"", $1)
      gsub(/"/, "\\\"", $2)
      gsub(/"/, "\\\"", $3)
      printf "{\"name\":\"%s\",\"status\":\"%s\",\"state\":\"%s\"}", $1, $2, $3
    }
    END { printf "]" }
  ')
fi

# 6. Monthly Bandwidth usage (vnStat)
rx=0
tx=0

if command -v vnstat >/dev/null 2>&1; then
  # Parse vnstat JSON using Python to guarantee robust version-independent parsing
  bandwidth_parsed=$(vnstat --json | python3 -c '
import sys, json
try:
    data = json.load(sys.stdin)
    if "interfaces" in data and len(data["interfaces"]) > 0:
        traffic = data["interfaces"][0]["traffic"]
        # Standard vnstat version structures: month or months
        month_list = traffic.get("month", traffic.get("months", []))
        if len(month_list) > 0:
            current = month_list[-1]
            print(f"{current.get(\"rx\", 0)},{current.get(\"tx\", 0)}")
            sys.exit(0)
except Exception:
    pass
print("0,0")
' || echo "0,0")

  rx=$(echo "$bandwidth_parsed" | cut -d',' -f1)
  tx=$(echo "$bandwidth_parsed" | cut -d',' -f2)
fi

cpu_val=$(get_cpu_usage)
timestamp=$(date +%s)

# Construct JSON payload
json_payload=$(cat <<EOF
{
  "timestamp": $timestamp,
  "cpu": $cpu_val,
  "ram": {
    "total": $ram_total,
    "used": $ram_used
  },
  "swap": {
    "total": $swap_total,
    "used": $swap_used
  },
  "disk": {
    "total": $disk_total,
    "used": $disk_used
  },
  "uptime": $uptime_seconds,
  "docker": {
    "running": $docker_running,
    "total": $docker_total,
    "unhealthy": $docker_unhealthy,
    "containers": $docker_list
  },
  "bandwidth": {
    "rx": $rx,
    "tx": $tx
  }
}
EOF
)

# 7. Security: Sign request body using HMAC-SHA256
signature=$(printf "%s" "$json_payload" | openssl dgst -sha256 -hmac "$MONITORING_SECRET" | awk '{print $NF}')

# Upload payload to Control Plane
curl -s -X POST \
  -H "Content-Type: application/json" \
  -H "X-Signature: $signature" \
  -H "X-Server-Alias: $SERVER_ALIAS" \
  -d "$json_payload" \
  "$CONTROL_PLANE_URL/monitoring/report"
