# DigitalOcean Droplet Provider Integration

The DigitalOcean provider adapter manages Droplets (virtual private servers) using the standard fetch-based REST requests against the DigitalOcean API v2.

## API Credentials

1. Log into your **DigitalOcean Control Panel**.
2. Navigate to **API** in the left sidebar menu.
3. Select **Tokens/Keys** tab and click **Generate New Token**.
4. Set the token name (e.g. `mosabbir-infra-bot-token`).
5. Under **Scopes**, choose **Custom Scopes** and select only the scopes required for your use case (see tables below).
6. Copy the generated Personal Access Token (PAT).

## Configuration

Bind the following secret in Cloudflare Secrets:
* `DIGITALOCEAN_TOKEN`: The copied personal access token.

---

## Required DigitalOcean Token Scopes

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

All lifecycle operations (start, stop, reboot, power cycle) use the same endpoint:

```
POST /v2/droplets/{droplet_id}/actions
Content-Type: application/json
Authorization: Bearer $DIGITALOCEAN_TOKEN

{
  "type": "<action_type>"
}
```

The `type` field determines the operation:

| Action Type | Behavior | Used By |
|---|---|---|
| `power_on` | Powers on a Droplet. | `/start` |
| `power_off` | Hard powers off a Droplet (like cutting power). | `/stop` |
| `reboot` | Graceful OS reboot (like `reboot` from console). Sends SIGTERM. | `/reboot` |
| `shutdown` | Graceful shutdown (like `shutdown` from console). | (alternative to `power_off`) |
| `power_cycle` | Hard reset (like pressing the reset button). Power off then on. | (available for future use) |

All droplet action types require **`droplet:update`** scope. The scopes `actions:read` and `actions:create` are **not** required for droplet lifecycle actions — they apply to the global Actions API, which this integration does not use.

### Scope Dependency Chain

When creating a custom-scoped token, DigitalOcean requires prerequisite scopes for non-read scopes. Selecting `droplet:update` in the UI will automatically require these additional scopes:

| Prerequisite Scope | Description | Required For |
|---|---|---|
| `droplet:read` | View Droplets | All droplet read endpoints |
| `regions:read` | View data center regions | Droplet action validation |
| `sizes:read` | View Droplet plan sizes | Droplet action validation |
| `actions:read` | View events / action records | Droplet action tracking |
| `image:read` | View images | Droplet action validation |

These are transparently added by the DigitalOcean token creation UI when you select `droplet:update`.

---

## Recommended Production Token

### Step-by-Step: Custom Scopes in the DO UI

In the **Custom Scopes** section of the token creation page, enable only these checkboxes:

| Resource | Checkbox | Label |
|---|---|---|
| `droplet` | ☑ **read** | View Droplets |
| `droplet` | ☑ **update** | Modify Droplets |

The DigitalOcean UI will automatically select the prerequisite scopes (`actions:read`, `regions:read`, `sizes:read`, `image:read`) when you check `droplet:update`. Your final selected count will show:

| Section | Count |
|---|---|
| **Read Access** | droplet (1), actions (1) |
| **Update Access** | droplet (1) |

Leave everything else unchecked. Do **not** check `droplet:create`, `droplet:delete`, `droplet:admin`, or any scope outside the `droplet` resource group.

### What This Token Can Do

| Scope | Reason |
|---|---|
| `droplet:read` | List droplets, get status, get metadata |
| `droplet:update` | Power on, power off, reboot |


---

## Optional Scopes

These scopes are **not required** for the bot's core operations but can be added if you extend functionality.

| Scope | Required For | Enable When |
|---|---|---|
| `droplet:create` | Creating new Droplets (`POST /v2/droplets`). Requires additional scopes: `ssh_key:read`, `vpc:read`, `block_storage:read`, `image:read`, `tag:create`. | You implement a `/create` or `/provision` command that spins up new Droplets. |
| `droplet:delete` | Deleting Droplets (`DELETE /v2/droplets/{id}`). | You implement a `/destroy` command. |
| `image:create` | Creating snapshots of Droplets. Combined with `droplet:update` for the snapshot action type. | You implement a `/snapshot` command. |
| `block_storage:read` | Listing and viewing Block Storage Volumes. | You implement volume management commands. |
| `block_storage:create` | Creating Block Storage Volumes. | You implement volume creation commands. |
| `firewall:read` | Listing and viewing Cloud Firewalls. | You implement firewall management commands. |
| `firewall:create` / `firewall:update` / `firewall:delete` | Managing Cloud Firewall rules. | You implement firewall CRUD commands. |
| `dns:read` | Reading DNS zones and records. | You implement DNS lookup commands. |
| `dns:create` / `dns:update` / `dns:delete` | Managing DNS records. | You implement DNS management commands. |

---

## Security Warning

> **Do not use Full Access tokens in production Telegram bots or public infrastructure automation systems.**

A Full Access token (equivalent to the `api:write` alias scope) grants unrestricted access to **every** resource and action in your DigitalOcean team. If the token is leaked:

- An attacker can **create, modify, or delete** every Droplet, database, volume, firewall, DNS record, load balancer, and Kubernetes cluster in the account.
- An attacker can **access** all team resources, read all images, SSH keys, and account details.
- An attacker can **escalate** by creating new API tokens or modifying team member permissions.
- **There is no way to limit scope after a leak** — the only recourse is to revoke the token and rotate every credential in the account.

**Best practices:**

- Always use **Custom Scopes** with the minimum permissions required.
- Create a dedicated token per bot or service, never share tokens across systems.
- Restrict the bot token to only the operations the bot actually performs (`droplet:read` + `droplet:update`).
- Regularly audit and rotate tokens in the DigitalOcean Control Panel.

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
* **Get Server Status**: `GET /v2/droplets/{id}`. Maps DigitalOcean droplet status (`active`, `new`, `off`, `archive`) to standard status states (`running`, `stopped`, `rebooting`, `unknown`).
* **List Servers**: `GET /v2/droplets`
* **Instance Metadata**: `GET /v2/droplets/{id}` — extracts public IP, private IP, region, size, and creation date.

---

## Status Mapping

| Droplet Status | Mapped Status | Description |
|---|---|---|
| `new` | `starting` | Droplet is provisioning |
| `active` | `running` | Droplet is powered on and running |
| `off` | `stopped` | Droplet is powered off |
| `archive` | `terminated` | Droplet has been destroyed and archived |
| *other* | `unknown` | Unrecognized or transitional state |
