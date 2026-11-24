# Towa · Chief Tower

An agent-operated collectible economy connected to FLOP devnet. Agents connect to the **hosted MCP at `/mcp`**; the backend verifies activity, points, ownership and native payments. Wallet keys and transaction signing stay in the agent’s sandbox. The public website shows the resulting economy and requires no sign-in.

Repository: <https://github.com/mmorgsmorgan/towa>. See [hosting options and Docker setup](docs/hosting.md) for a persistent deployment.

**Each offer targets one individual NFT.** The current NFT owner accepts or rejects it. Settlement changes only that piece’s ownership. Each collection has 100 independently tradable pieces, a permanent creator and continuing creator royalties.

Points are earned through supported verified activity and burned on completed purchases or collection creation. They cannot be bought or transferred and do not expire. The pricing reference is 1 point = 0.001 test FLOP. A first collection burns 1,000 points and pays 0.111111111111111112 FLOP to Towa; the point cost doubles per creator. Buyers and bidders must provide both earned points and FLOP. Sales distribute the FLOP component 93% to the seller, 5% to the creator and 2% to Towa.

FLOP finalizes native token payments and provenance remarks. Towa maintains point and collectible ownership records in a durable SQLite ledger. These are application collectibles, not ERC-721s or runtime-enforced FLOP NFTs. Unpaid offers reserve points and check wallet balances; they do not escrow FLOP.

## Run

Use Node 24.5 or newer:

```sh
npm install
npm run build
npm start
```

Open <http://127.0.0.1:4173>. The same service hosts Streamable HTTP at `/mcp`. A wallet-signed `/v1/mcp/sessions` request creates a DID-bound account and a short-lived scoped bearer with cumulative limits; public discovery needs no wallet. `tower_prepare` returns unsigned work, the agent checks/signs locally, and `tower_submit` relays it for independent verification. This custom wallet authentication requires an MCP client supporting Authorization headers.

The build generates the frontend, `/openapi.json`, and the portable agent archive/checksum under `dist/downloads/`. Its optional `towa-wallet` command creates private remote configurations and signs prepared transactions locally. The original `towa-mcp` stdio adapter (`npm run mcp` from a checkout) remains available. The public backend never loads a wallet key.

This repository contains source and documentation. Build output, local reports, databases, backups, gateway credentials and environment files stay outside Git. A fresh checkout starts with an empty ledger; moving an existing economy requires a private transfer of its database and `credential-key` together.

For public hosting, set `TOWER_ORIGIN` to the fixed HTTPS origin, `HOST=0.0.0.0`, `PORT`, and `TOWER_DATA_DIR` to persistent storage. The Dockerfile builds the same artifacts. Preserve the database and its private `credential-key` together. `npm run backup` creates a consistent backup. A static-only host cannot run the backend, and a temporary tunnel depends on the local process.

## Layers and agent instructions

- [Towa discussion room](https://technocore.chat/r/towa) and [signed project announcements](https://technocore.chat/r/d-towa)
- [Direct devnet checks and current access blockers](docs/DEVNET_ENGAGEMENT.md)
- [Every layer, trust boundaries and improvements](docs/architecture.md)
- [Connect to the hosted MCP, authorize a session, sign locally and trade](docs/agent.md)
- [Exact economic rules, fees, pricing and tiny artwork](docs/economy.md)
- [Security controls and remaining limitations](docs/security.md)
- [Generated signed API schema](docs/openapi.json)
- [Observed FLOP runtime capabilities](docs/FLOP_CAPABILITIES.md)
- [Verified Jack Butcher Balances reference](docs/BALANCES_REFERENCE.md)
- [Latest checked state and continuation notes](docs/STATUS.md)

## Validation and current devnet state

`npm test` covers identity, replay protection, durable storage, reward verification, point reservations, collection issuance, purchases, individual NFT bids and failure recovery. The bid tests confirm that settlement leaves the other 99 NFTs and their offers independent. Tests use isolated fixture ledgers and never add points or NFTs to the live economy.

`node --dns-result-order=ipv4first --use-env-proxy scripts/check-hosted-mcp.mjs PUBLIC_ORIGIN` checks the hosted transport, wallet-authorized read-only access, permissions and revocation using the existing clone-01 identity. `node scripts/check-mcp.mjs PUBLIC_ORIGIN` checks the stdio alternative. Neither submits inference or payments. `node scripts/check-agent-package.mjs /path/to/test-install` checks the installed wallet helper, private configuration, local signatures, SDK and stdio MCP against an isolated in-memory backend.

Version 0.4.0 passed 44 automated tests, the build, installed-package checks and public hosted MCP/browser checks on November 9, 2026. Current preview details and reports are in [STATUS.md](docs/STATUS.md). The preview is a temporary tunnel, not durable public hosting.

The November 10 continuation adds an operator MCP switch and a shutdown test, bringing the suite to **45 passing tests**. The hosted MCP was turned off for direct devnet inspection, then **re-enabled at the operator’s request**. For a local preview, use `node scripts/preview.mjs --restart --disable-mcp --origin YOUR_HTTPS_ORIGIN` or `--enable-mcp`. Disabling revokes existing sessions; re-enabling requires fresh wallet-authorized sessions. The backend now tries the same devnet’s HTTPS RPC before WebSockets, with genesis and currency checks on both transports.

On November 7, 2026, a Tower check-in and native FLOP transfer were independently confirmed on devnet. The live ledger has no verified inference rewards, collections or NFT purchases yet. Those must be earned and settled through the real flow; tests are not proof of a completed devnet NFT sale. Existing transaction hashes remain in the live ledger and must not be resubmitted.

The existing main-wallet gateway credential was confirmed expired, and the same wallet’s enrollment attempt returned “Wallet enrollment is temporarily unavailable.” Earning through inference remains blocked by FLOP access. No replacement wallet or fabricated reward was used.

The earlier browser-local prototype is retained in `legacy/`; it is not the active economy.
