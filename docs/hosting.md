# Hosting Towa

Checked November 24, 2026. Towa needs a Node.js 24.5+ server, a persistent SQLite ledger and background reconciliation workers. The public website and MCP endpoint run in the same process. Static-only hosting does not run this backend.

## Recommended $0 option: Oracle Cloud Always Free

An Always Free Linux VM fits the current application without replacing its database or worker architecture. Oracle currently documents an Ampere A1 allowance equivalent to **2 OCPUs and 12 GB RAM**, plus **200 GB combined boot/block storage** across the tenancy. Create eligible resources in the home region and keep the total within the free allowance.

Account signup normally requires a supported payment card for verification. Free compute capacity can be unavailable, and Oracle can reclaim idle instances. Keep independent backups of the ledger and its encryption key. This is a free-tier deployment, not a guarantee of uninterrupted service.

Sources: [Always Free resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm), [Free Tier FAQ](https://www.oracle.com/cloud/free/faq/).

## Other free options

| Host | Fit for this application |
| --- | --- |
| Render Free | Useful for a disposable demo. Free services sleep after 15 minutes without inbound traffic and lose local files on restart, redeploy or spin-down. Persistent disks require paid compute, so the current SQLite ledger cannot be kept reliably on this tier. |
| Railway Free | No card required; includes $1 of monthly usage credit, up to 0.5 GB RAM and a 0.5 GB volume per service. The volume can keep SQLite, but the small credit budget is unsuitable for continuous background reconciliation without measuring usage and changing worker scheduling. |
| Cloudflare Workers + D1 | A possible future free-tier deployment. Requires changing the HTTP server, synchronous SQLite access, filesystem use and background scheduling. The existing Docker/Node app does not deploy directly to Workers. |
| Your own machine + Cloudflare Tunnel | Keeps SQLite locally and can avoid a hosting bill, but availability depends on your machine and internet. Quick Tunnel hostnames are temporary; a stable hostname needs a domain and a named tunnel. |

Sources: [Render Free](https://render.com/docs/free), [Railway pricing](https://railway.com/pricing), [Cloudflare Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/).

## Run the existing Docker application

On a Linux host with Docker installed, clone the repository and build the image:

```sh
git clone https://github.com/mmorgsmorgan/towa.git
cd towa
docker build -t towa:local .
docker volume create towa-data
```

Choose the fixed public HTTPS origin before starting the server:

```sh
docker run -d --name towa --restart unless-stopped \
  -p 127.0.0.1:8080:8080 \
  -e TOWER_ORIGIN=https://YOUR_PUBLIC_HOSTNAME \
  -v towa-data:/data \
  towa:local
```

Put an HTTPS reverse proxy or named tunnel in front of `http://127.0.0.1:8080`. Preserve the public `Host` header and allow streaming HTTP on `/mcp`. Set `TOWER_ORIGIN` to that exact public origin; wallet signatures and MCP sessions are bound to it. The public website needs no sign-in gate.

Check the service locally and through the public origin:

```sh
curl -fsS http://127.0.0.1:8080/api/health
curl -fsS https://YOUR_PUBLIC_HOSTNAME/api/health
```

The named volume preserves `/data/tower.sqlite` and `/data/credential-key` across container replacements. Do not delete the volume when updating. A fresh volume creates a new, empty economy; it does not import this workstation's existing ledger or credentials. Transfer existing data privately while its source server is stopped, including the encryption key and any outstanding-operation journals.

Back up the live database consistently with `scripts/backup.mjs`; do not copy a running SQLite database by itself. Backups include private material and must stay out of Git and public downloads.

Hosting supplies the application server. FLOP must separately provide valid gateway access for inference, and this version remains configured for Devnet.
