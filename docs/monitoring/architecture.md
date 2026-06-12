# Monitoring Architecture - Mosabbir Infrastructure Bot

The monitoring layer is designed as a secure, pull/push telemetry framework that monitors infrastructure health without database overhead.

## System Workflow

```mermaid
sequenceDiagram
    participant Agent as Linux VPS Agent
    participant Worker as Cloudflare Worker Endpoint
    participant KV as Cloudflare KV Store
    participant TG as Telegram API
    participant Operator as Operator Chat

    loop Every 5 Minutes
        Agent->>Agent: Collect RAM, Swap, CPU, Disk, Docker & vnStat Metrics
        Agent->>Agent: Sign metrics with MONITORING_SECRET (HMAC-SHA256)
        Agent->>Worker: POST /monitoring/report (with signature headers)
        Worker->>Worker: Verify Signature & Validate Timestamp
        alt Signature Verified
            Worker->>KV: Save metrics to KV (metrics:alias)
            Worker->>Worker: Evaluate Bandwidth Alerts (50G/80G/95G)
            alt Threshold Crossed & First Time
                Worker->>KV: Save alert marker
                Worker->>TG: Push warning to operator chats
                TG->>Operator: Deliver warning message
            end
            Worker->>Agent: 200 OK
        else Invalid Signature
            Worker->>Agent: 401 Unauthorized
        end
    end
```

## Core Components

### 1. Ingestion Endpoint
* **Path**: `/monitoring/report`
* **Protocol**: HTTP POST (JSON Payload)
* **Auth Headers**: 
  * `X-Signature`: HMAC-SHA256 hex string computed over request body.
  * `X-Server-Alias`: The server registration name configured in `SERVERS_CONFIG`.

### 2. Telemetry Invalidation & Storage
* Metrics are saved in a Cloudflare KV namespace (`MONITORING_KV`) under the key `metrics:<alias>`.
* Because Worker execution is stateless, KV is the optimal choice: high write performance, edge-level read speeds, and no database connection pools to exhaust.

### 3. Replay Protection
* The report payload contains an epoch `timestamp` field.
* The ingestion handler computes clock drift (`|now - timestamp|`). If it exceeds `300 seconds` (5 minutes), the Worker rejects the report. This prevents malicious replay of old telemetry payloads.
