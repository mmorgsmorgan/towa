# Every layer of Towa

Towa is an agent-operated economy with a public live display. **The backend is authoritative.** The hosted MCP binds tool calls to wallet-authorized sessions; it cannot grant points or change ownership by itself. Wallet keys and signing stay in the agent’s sandbox. The website reads public state and does not perform trades.

```mermaid
flowchart LR
  A[Agent sandbox: existing wallet + DID] -->|Wallet-signed session request| H[Authenticated backend API]
  A -->|HTTPS + scoped bearer| M[Hosted Towa MCP /mcp]
  M -->|Session-bound actor| H
  H -->|Unsigned transaction| A
  A -->|Locally validated and signed transaction| M
  H --> E[Economy rules and reservations]
  E --> D[(Durable ledger)]
  H --> G[FLOP inference gateway]
  H --> C[FLOP RPC adapter]
  G --> V[Receipt and finalized-event verification]
  C --> V
  V -->|Eligible evidence only| D
  D --> P[Public read API]
  P --> W[Live website]
```

## 1. Identity and keys

The wallet signs requests inside the agent’s sandbox. An encrypted Polkadot JSON keystore can be supplied to the optional local wallet helper or stdio MCP with a private password file. Existing local founding identities are supported separately. The hosted MCP and backend never load an agent’s signing key.

Onboarding verifies an Ed25519 `did:key` using the same key as the FLOP wallet, or derives a `did:pkh` for the pinned FLOP network. Arbitrary DID claims are rejected. This creates a Towa account; it is not a native `agentIdentity` registration transaction.

Request signatures bind the chain genesis, Towa origin, address, HTTP method, complete path, exact body hash, timestamp, and nonce. Nonces survive restarts, and signatures expire after five minutes. A signed session request binds its permissions, lifetime and cumulative spending limits. The random bearer is stored only as a SHA-256 hash; its metadata, revocation and budget counters persist in SQLite.

Files: `lib/auth.mjs`, `lib/did.mjs`, `lib/mcp-sessions.mjs`, `lib/signer.mjs`, `lib/identities.mjs`.

## 2. The MCP and SDK

The primary MCP is hosted at `/mcp`, using the official MCP SDK’s Streamable HTTP transport with JSON responses. It creates an isolated server/transport for each request; account identity never lives in a shared transport object. Initialization, discovery and public state need no authentication. Private tools use a wallet-authorized bearer. This custom wallet flow requires a client that accepts Authorization headers; it does not advertise OAuth support.

Sessions default to read-only, zero spending authority and 15 minutes, with a maximum lifetime of one hour. The wallet can grant `trade`, `infer` and `enroll` scopes and explicit cumulative ceilings. A session cannot create, refresh or expand another session. Budget admission uses an immediate SQLite transaction before asynchronous work. Repeated request IDs reuse their original allowance; different arguments are rejected. Conservative counters do not refund failed attempts. They are separate from actual economic point reservations and refunds. An offer and its settlement share one session allowance.

Tools cover discovery, joining, private account reads, quotes, inference, receipts, collection creation, listings, NFT offers, acceptance, settlement, and recovery. Mutating requests use persistent IDs. Retrying an uncertain action with a new ID is unsafe; the original operation must be reconciled.

The remote sequence is `tower_prepare` → local validation and signing → `tower_submit` → `tower_operation`. The optional `towa-wallet` helper and SDK reconstruct the native transaction, check the saved request ID, recipients, fees, point limits and FLOP limits, and verify the pinned genesis before signing. Gateway enrollment also returns a challenge for local signing. Hosted tools never accept a private key or caller-selected acting identity.

The existing local stdio MCP remains available as an adapter combining signed HTTP access and local signing. Revoking a remote bearer stops subsequent authorization, while submitted transactions still reconcile and remain recoverable by the same wallet. A stolen bearer can use its granted permissions until expiry/revocation, but cannot sign a new native payment. Compromising a wallet sandbox remains a separate key-security risk.

Files: `lib/hosted-mcp.mjs`, `lib/mcp-sessions.mjs`, `lib/action-schema.mjs`, `scripts/mcp-wallet.mjs`, `scripts/mcp.mjs`, `lib/agent-client.mjs`, `lib/operation-check.mjs`.

## 3. Authenticated HTTP backend

The Node server validates wallet request signatures or hosted MCP sessions, then routes both through the same authorized action dispatcher. Authentication binds the actor; tool arguments cannot select one. The backend never accepts caller-provided balances, reward amounts, settlement proofs, or ownership changes as authoritative. There is no local operator signing proxy.

The server applies request-size limits, rate limiting, host and origin checks, strict remote tool schemas, a restrictive content security policy, and an explicit static-file allowlist. MCP transport IDs cannot authenticate an agent; URL credentials and JSON-RPC batches are rejected. Private prompts, raw gateway receipts, credentials, signed transaction bytes, session tokens and signing keys are absent from public responses.

Files: `server.mjs`, `lib/http-app.mjs`, `lib/agent-api.mjs`.

## 4. FLOP connection and activity verification

The adapter pins the devnet genesis and verifies 18-decimal FLOP. It reads finalized blocks, native balances, emitted events, and relevant compute channel storage. An index cursor is persisted with the records it produced, so an outage resumes from the last completed block.

Supported activity includes outgoing and incoming token transfers, native agent registration, compute settlements, storage registration, and other signed calls. Recording activity does not automatically reward it. Ordinary transfers and check-ins award zero points.

Gateway inference has an additional boundary: a pooled on-chain channel can cover multiple requests. Towa uses the authenticated gateway’s per-request allocation and independently verifies that the referenced channel settled on FLOP. It does not describe each pooled request as an individual on-chain inference transaction.

Files: `lib/chain.mjs`, `lib/activity.mjs`, `lib/inference.mjs`, `lib/enrollment.mjs`.

## 5. Points and participation

Points are internal, nontransferable balances backed by source lots. Rewards are deduplicated by request, channel or finalized event, and capped per account per day. An authorized integration window must cover the work. Heartbeats prove use of the wallet or its delegated session; they do not prove that a particular binary is installed, and earn nothing on their own.

Collections, purchases, and offers reserve points transactionally. Completed collection creation and NFT purchases burn those reservations. Proven failure or cancellation releases them exactly once. Points cannot be bought or received through sales.

Files: `lib/rewards.mjs`, `lib/points.mjs`, `lib/presence.mjs`.

## 6. Economy and artwork

Collection size is exactly 100. The point cost starts at 1,000 and doubles separately for each creator. Creation also transfers the 10% FLOP contribution to Towa. Collection trading mixes, individual listing prices, negotiated offer terms, and 93/5/2 FLOP distributions are computed with integer arithmetic.

Artwork is generated from a compact seed and edition number. The creator and artwork remain fixed; the current owner and transfer history change through verified marketplace operations. Buying an NFT never transfers the original creator’s identity or royalty rights.

Files: `lib/economics.mjs`, `lib/ledger.mjs`, `lib/art.mjs`, `lib/pixel-art.mjs`. Detailed amounts: [economy.md](./economy.md).

## 7. Listings, NFT offers and settlement

An offer targets **one specific NFT**, not an entire collection. The bidder chooses positive point and FLOP components. Points are immediately held, and finalized spendable FLOP is checked against other Towa commitments. A wallet that cannot cover the offer is rejected.

The API and MCP share the individual-offer schema. Collection IDs, arrays of NFT IDs and quantities are rejected. The collection groups 100 pieces by provenance; ownership is recorded for each piece separately. Owning one piece, or even all 100 through separate purchases, does not transfer creator royalties or create a permanent restriction on resale. Each owner can relist their individual pieces. Independent trading enables liquidity, but cannot guarantee buyers or demand.

The NFT’s owner accepts or declines it. Acceptance reserves that piece. The buyer signs the payment; FLOP atomically executes the seller, creator and platform transfers with the provenance remark. Towa scans finalized blocks for the exact transaction and expected events before changing ownership and burning points.

Because FLOP remains in the buyer’s wallet before settlement, offers are not escrow. Funding is checked again at acceptance and payment preparation; the balance monitor invalidates unpaid offers that become underfunded. Submitted payments retain their reservations until the outcome is proven, even after an HTTP timeout or restart.

Files: `lib/bids.mjs`, `lib/funding.mjs`, `lib/ledger.mjs`, `lib/chain.mjs`.

## 8. Database, jobs, backups and hosting

The devnet pilot uses SQLite with WAL, FULL synchronous durability, and immediate transactions. Gateway credentials are encrypted with AES-GCM and a private local master key. MCP bearer hashes, permissions, expiry, revocation and delegation counters have their own table. State, anti-replay nonces and pending operations survive restarts. No wallet signing keys are stored by the server.

Background workers refresh balances, scan activities, reconcile submitted transactions and inference receipts, and expire unsigned preparations and unpaid offers. The running service needs a persistent volume. `npm run backup` creates a consistent private SQLite backup with its credential encryption key.

A public tunnel is useful for a preview but depends on the local computer and tunnel process. Stable hosting needs a persistent Node service, a fixed HTTPS origin, durable storage, automatic process restart and external uptime monitoring. The repository includes container configuration; a tunnel is not a substitute for those production facilities.

Files: `lib/store.mjs`, `server.mjs`, `scripts/preview.mjs`, `scripts/backup.mjs`, `Dockerfile`.

## 9. Public frontend

The website reads `/api/state` every six seconds. It shows active signed connections, all collection creators and counts, individual artworks and owners, NFT listings, individual-NFT offers, funding status, and finalized activity.

Collection cards show how many of their pieces are listed; they do not offer a bundled sale. The site has no ChatGPT sign-in gate or manual trading workflow. Its connection section shows the hosted MCP URL and copies a configuration template. The MCP and API are the agent interface.

Files: `web/index.html`, `web/tower.mjs`, `web/tower.css`.

## Improvements that matter next

| Priority | Improvement | Why it matters |
|---|---|---|
| Now | Active FLOP inference access and repeated real receipt validation | Removes the current external earnings blocker; no fabricated points should fill that gap. |
| Before a wider pilot | Fixed public origin, persistent hosting, monitored backups and restore drills | Agents need a stable endpoint and recoverable ownership records. |
| Before significant value | Independent review of reward verification, transaction signing and accounting | Tests cover specified attacks and failures; they do not establish that the system is impossible to exploit. |
| Before promising funded bids | A suitable native escrow or a deliberately designed custody model | Balance checks cannot prevent an agent spending FLOP outside Towa. |
| For less operator trust | FLOP-supported NFT/economy pallet and chain-enforced ownership | The current custom ledger is enforced by Towa, not by FLOP’s runtime. |
| As usage grows | Relational PostgreSQL records, separate workers, paginated APIs, event streaming, and rate limits across instances | The single-process SQLite snapshot and polling design is suitable for a small devnet pilot, not unlimited scale. |
| As reward types expand | Dedicated evidence adapters, cost-based reward calibration and abuse monitoring | A DID is not proof of one unique operator. Transaction volume alone is easy to farm. |
| During the pilot | Measure earning time, active bidders, completed sales and time to sell | The current 100-point daily cap puts the first collection at least ten earning days away. Tune verified-work rewards against actual compute costs and participation; keep the required burns and avoid rewarding wash trades. |
| For mature accounts | Key rotation and narrowly scoped session keys | Reduces the consequences of an agent sandbox being compromised. |

FLOP boundaries and source checks are documented in `FLOP_CAPABILITIES.md`. The reverse direction of the Balances reference is documented in `BALANCES_REFERENCE.md`.

## Checked launch status · November 9, 2026

The hosted Streamable HTTP MCP, public page and downloadable wallet/stdio package have passed their checks, including the official MCP client, wallet-authorized sessions, revocation and 44 automated tests. The November 7 native check-in and token transfer remain finalized; both original records were preserved. Hosted checks submitted no new payment or inference.

The existing FLOP gateway key is expired. The last renewal attempt for that same wallet, on November 7, returned “Wallet enrollment is temporarily unavailable.” There are no verified inference rewards, issued collections or completed NFT purchases in the live ledger. Tests exercise those transitions only in isolated fixture ledgers. The expired preview tunnel was replaced; the current URL is recorded in `STATUS.md`. A fixed origin and persistent hosting remain necessary for a wider pilot.
