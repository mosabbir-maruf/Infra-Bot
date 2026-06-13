# DigitalOcean Droplet Provider Integration

The DigitalOcean provider adapter manages Droplets (virtual private servers) using the standard fetch-based REST requests against the DigitalOcean API v2.

## API Credentials

### Create a Personal Access Token

1. Log into your **DigitalOcean Control Panel**.
2. Navigate to **API** → **Tokens/Keys** tab → click **Generate New Token**.
3. Set the token name (e.g. `mosabbir-infra-bot-token`), leave expiration as desired.
4. Under **Scopes**, choose **Custom Scopes**.

### Select the Right Scopes

In the **Custom Scopes** section, scroll to the `droplet` resource group and enable exactly these two checkboxes:

| Resource | Checkbox | Label |
|---|---|---|
| `droplet` | ☑ **read** | View Droplets |
| `droplet` | ☑ **update** | Modify Droplets |

**Do not** enable any other checkboxes. In particular leave unchecked:
- `droplet` → `create`
- `droplet` → `delete`
- `droplet` → `admin`
- Any scope outside the `droplet` resource group

### What Happens Automatically

When you check `droplet:update`, the DigitalOcean UI automatically selects these prerequisite scopes (you will see them appear in the selected scopes summary):

| Prerequisite Scope | Description |
|---|---|
| `regions:read` | View data center regions |
| `sizes:read` | View Droplet plan sizes |
| `actions:read` | View events of shared resources |
| `image:read` | View images |
| `snapshot:read` | View snapshots |

No action needed — these are added for you. Your final selected scopes summary will show:

| Section | Count |
|---|---|
| **Read Access** | droplet (1), actions (1) |
| **Update Access** | droplet (1) |

All 5 required scopes are transparently handled by the UI and require no additional action on your part.

5. Click **Generate Token** and **copy the token immediately** — you will not see it again.

> ⚠ **Security:** A Full Access token is dangerous for bot use. If the token is leaked, an attacker gains full control of your DigitalOcean account. Custom scopes limit the blast radius. See the Security Warning section below.

## Configuration

Bind the following secret in Cloudflare Secrets:

```
npx wrangler secret put DIGITALOCEAN_TOKEN
```

Or for local development, add it to `.dev.vars`:

```
DIGITALOCEAN_TOKEN="dop_v1_abcdef1234567890abcdef1234567890"
```

---

## Required Scopes Reference

### Per-Endpoint Scope Requirements

| Operation | API Endpoint | HTTP Method | Required Scope |
|---|---|---|---|
| List Droplets | `/v2/droplets` | GET | `droplet:read` |
| Get Droplet Details | `/v2/droplets/{id}` | GET | `droplet:read` |
| Get Droplet Status | `/v2/droplets/{id}` | GET | `droplet:read` |
| Start Droplet | `/v2/droplets/{id}/actions` | POST | `droplet:update` |
| Stop Droplet | `/v2/droplets/{id}/actions` | POST | `droplet:update` |
| Reboot Droplet | `/v2/droplets/{id}/actions` | POST | `droplet:update` |
| Power Cycle Droplet | `/v2/droplets/{id}/actions` | POST | `droplet:update` |
| Create Droplet | `/v2/droplets` | POST | `droplet:create` |
| Delete Droplet | `/v2/droplets/{id}` | DELETE | `droplet:delete` |

### How Droplet Actions Work

All lifecycle operations use the same API endpoint with a different `type` value:

```
POST /v2/droplets/{droplet_id}/actions
Content-Type: application/json
Authorization: Bearer $DIGITALOCEAN_TOKEN

{
  "type": "<action_type>"
}
```

| Action Type | Behavior | Used By |
|---|---|---|
| `power_on` | Powers on a Droplet. | `/start` |
| `power_off` | Hard powers off a Droplet (like cutting power). | `/stop` |
| `reboot` | Graceful OS reboot (sends SIGTERM, like `reboot` from console). | `/reboot` |
| `shutdown` | Graceful shutdown (like `shutdown` from console). | Alternative to `power_off` |
| `power_cycle` | Hard reset (power off then on, like pressing the reset button). | Available for future use |

All droplet action types require **`droplet:update`** — not `actions:create`. The `actions:create` scope applies to the standalone Actions API (`POST /v2/actions`), which this integration does not call.

---

## Recommended Production Token

The two scopes selected above (`droplet:read` + `droplet:update`) are the minimum needed for all bot operations:

| Scope | Required For |
|---|---|
| `droplet:read` | List droplets, get status, get metadata |
| `droplet:update` | Power on, power off, reboot |

With this token you can: start, stop, reboot, query status, list droplets, and read metadata.
Without adding `droplet:create`/`droplet:delete`, you **cannot** create or destroy droplets.

---

## Optional Scopes

Add these only if you extend the bot's functionality:

| Scope | Required For | Enable When |
|---|---|---|
| `droplet:create` | Creating new Droplets (`POST /v2/droplets`). Also adds `ssh_key:read`, `vpc:read`, `block_storage:read`, `image:read`, `tag:create`. | You add a `/create` or `/provision` command. |
| `droplet:delete` | Deleting Droplets (`DELETE /v2/droplets/{id}`). | You add a `/destroy` command. |
| `image:create` | Creating snapshots. Combined with `droplet:update` for the snapshot action type. | You add a `/snapshot` command. |
| `block_storage:read` | Viewing Block Storage Volumes. | You add volume management commands. |
| `block_storage:create` | Creating Block Storage Volumes. | You add volume creation commands. |
| `firewall:*` | Managing Cloud Firewall rules. | You add firewall CRUD commands. |
| `dns:*` | Managing DNS records. | You add DNS management commands. |

---

## Security Warning

> **Do not use Full Access tokens in production Telegram bots or public infrastructure automation systems.**

A Full Access token (equivalent to `api:write`) grants unrestricted access to **every** resource in your DigitalOcean team. If leaked:

- An attacker can **create, modify, or delete** every Droplet, database, volume, firewall, DNS record, load balancer, and Kubernetes cluster.
- An attacker can **read** all account resources, SSH keys, and images.
- An attacker can **escalate** by creating new API tokens or modifying team permissions.
- **The only recourse after a leak** is to revoke the token and rotate every credential.

**Best practices:**

- Always use **Custom Scopes** with the minimum permissions (`droplet:read` + `droplet:update`).
- Create a dedicated token per service; never share tokens across systems.
- Regularly audit and rotate tokens in the DigitalOcean Control Panel.
- Treat the token as a secret — never hardcode it, never commit it to version control.

---

## Command Mappings

* **Start Server**: `POST /v2/droplets/{id}/actions`
  ```json
  { "type": "power_on" }
  ```
* **Stop Server**: `POST /v2/droplets/{id}/actions`
  ```json
  { "type": "power_off" }
  ```
* **Reboot Server**: `POST /v2/droplets/{id}/actions`
  ```json
  { "type": "reboot" }
  ```
* **Get Server Status**: `GET /v2/droplets/{id}`. Maps droplet status (`active`, `new`, `off`, `archive`) to standard states (`running`, `stopped`, `rebooting`, `unknown`).
* **List Servers**: `GET /v2/droplets`
* **Instance Metadata**: `GET /v2/droplets/{id}` — extracts public IP, private IP, region, size slug, and creation date.

---

## Status Mapping

| Droplet API Status | Mapped Status | Meaning |
|---|---|---|
| `new` | `starting` | Droplet is provisioning |
| `active` | `running` | Droplet is powered on |
| `off` | `stopped` | Droplet is powered off |
| `archive` | `terminated` | Droplet has been destroyed and archived |
| *other* | `unknown` | Unrecognized or transitional state |
