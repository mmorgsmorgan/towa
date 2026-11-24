# Towa continuation record · November 9, 2026

## Latest inspection · November 24, 2026

The current configuration still targets FLOP **Devnet**, not the Testnet that opened on November 24. A read-only inspection found no inference sessions or verified inference rewards in the local ledger. The saved main gateway credential expired on November 6; the live gateway status endpoint returned HTTP 401 `api_key_expired` on November 24. No inference, enrollment, faucet claim or payment was submitted by that inspection.

The local Towa server was stopped, and the saved temporary preview hostname timed out during DNS resolution. Treat the older public preview below as historical. A persistent host and restored gateway access are separate requirements; publishing or hosting Towa does not issue an inference allowance.

## Latest continuation · November 10, 2026

**Hosted MCP is enabled.** The operator first requested a shutdown for direct devnet exploration, then explicitly requested reactivation for testing. Shutdown revoked existing sessions and refused both MCP requests and new session issuance. The final preview process was restarted with `--enable-mcp`; old credentials remain revoked.

- Public origin remains <https://photograph-carry-ladder-consultation.trycloudflare.com>, with no ChatGPT sign-in gate.
- Created and verified [d-towa](https://technocore.chat/r/d-towa) under the existing main DID, plus the open [towa](https://technocore.chat/r/towa) discussion room, topics and DID profile. Both rooms contain signed MCP-reactivation updates at sequence 2.
- `npm test`: **45 passed**, including shutdown revocation, disabled session creation, and continued signed HTTP/public website access.
- The rebuilt frontend passed public desktop/mobile checks, copying the active hosted MCP configuration, download checksum, API discovery and private-route protection, with no JavaScript errors. See `outputs/ui-smoke.json`. The MCP-off notice now clears on reactivation without requiring a page reload.
- Live hosted MCP checks passed for **clone-01 and chief-node**: 17-tool discovery, wallet-authorized private access, scope enforcement, rejection of collection bids and session revocation. No inference or native payments were submitted by those checks.
- Read finalized devnet block **3,338,792**, runtime **1014014** through HTTPS. Main held **25 test FLOP**, all six wallets were funded, and none had a native agent-wallet or agent-identity registration. No faucet request was needed.
- Main gateway access still returns **401 `api_key_expired`**. Public direct-session offers and the native appraisal registry were empty. The latest SDK 0.5.1 supports the current runtime; no unsupported client guard was bypassed.
- Later native RPC requests returned **503**. Both room-provenance attempts stopped at connection setup before signing or submission. `outputs/direct-devnet-room-anchor-preflight.json` confirms `not_submitted` and no transaction hash. No new on-chain fees were spent.
- A focused, signed existing-wallet access inquiry was posted in the [dev room at sequence 298381](https://technocore.chat/r/dev?since=298380&limit=1), with replies directed to `towa`. No reply was present when checked. No automated posting or task-claiming worker was started.
- `Chain` now prefers the same pinned devnet’s HTTPS RPC, falling back to WebSockets. This does not skip the activity cursor or change reward rules. An upstream outage still blocks fresh chain verification.

See [direct devnet engagement](DEVNET_ENGAGEMENT.md) for evidence, room protocol details and remaining requirements. The original finalized operations below must not be repeated.

## Hosted MCP delivered · version 0.4.0

- Public website: <https://photograph-carry-ladder-consultation.trycloudflare.com>
- Hosted MCP: <https://photograph-carry-ladder-consultation.trycloudflare.com/mcp>
- Agent instructions: `/agent.md`; discovery: `/.well-known/agent-card.json`; generated API schema: `/openapi.json`.
- Download: `/downloads/towa-agent-0.4.0.tgz`; SHA-256 `4fd09d18fa075d161e0d93df620b2cf99682ad14afb3f3b6e75c58e2d8e41c20`.

The MCP runs on Towa’s server using the official SDK’s stateless Streamable HTTP transport and 17 tools. Agents can connect directly from a compatible MCP client. The optional local `towa-wallet` helper creates private configuration files, signs gateway challenges, and validates/signs native transactions. Existing `towa-mcp` stdio integrations remain supported.

A wallet-signed `POST /v1/mcp/sessions` creates the matching DID account and returns a random bearer once. Defaults: read access, zero spending authority and 15 minutes. Maximum lifetime: one hour. Optional `trade`, `infer` and `enroll` permissions and cumulative limits are bound by the wallet signature. Only token hashes are stored. Revocation, expiry, anti-replay nonces and budget admission survive restarts. A bearer cannot refresh or upgrade itself.

Remote payments use `tower_prepare` → local validation/signing against the saved intent → `tower_submit` → `tower_operation`. No wallet key is loaded by the hosted service. Native enrollment likewise needs a local wallet signature. Both HTTP and MCP use the same authoritative backend. This is custom wallet-to-bearer authentication, not OAuth; clients need support for Authorization headers or a local adapter.

Checked November 9:

- `npm test`: **44 passing tests**, including official MCP client compatibility, concurrent account isolation, spoofed origins/hosts, proof replay, scope enforcement, spending races, revocation during funding, durable budgets/expiry and individual-NFT settlement.
- `npm run build`: passed; frontend, schema and portable wallet/MCP archive generated.
- Final archive installed into `/tmp/towa-agent-install-0.4.0-final-20261109`. The encrypted-wallet helper created a private remote configuration, signed a fixture enrollment challenge and revoked its session. SDK and optional stdio MCP checks passed. See `outputs/package-smoke.json`.
- The public hosted MCP passed connection, discovery, private access with the existing clone-01 wallet, scope rejection, rejection of collection bids and revocation. Its test session was revoked. **No native transactions or inference were submitted.** See `outputs/hosted-mcp-smoke.json`.
- The public desktop/mobile page, copied hosted configuration, discovery, docs, archive checksum and protected private routes passed with no JavaScript errors. The website requires no sign-in. See `outputs/ui-smoke.json` and the screenshots in `outputs/`.
- Runtime dependency installation reported zero known vulnerabilities after pinning the current MCP SDK and patched AJV.
- A consistent private backup was made before restarting: `data/backups/2026-11-09T21-25-20-974Z`. It contains the credential encryption key; do not publish it.

The old Cloudflare tunnel was withdrawn upstream (`Unauthorized: Tunnel not found`) and its hostname no longer resolved. The checked replacement above is still **temporary hosting**, dependent on this machine and its processes. `scripts/public-preview.mjs --renew` now supports replacing an expired tunnel after verifying the executable. Process records remain in `data/preview-process.json` and `data/tunnel-process.json`. Future replacements need a new origin and new origin-bound sessions. A fixed origin and persistent hosting remain a priority.

The public ledger still contains the two previously finalized native operations below, and **zero verified inference rewards, points, collections or NFT trades**. The indexer continues from its saved cursor; do not skip it forward. Fixture points/NFTs were never added to this ledger. The last main-wallet gateway renewal result remains the November 7 enrollment-unavailable response; no new inference or enrollment attempt was made during hosted-MCP verification. Recover supported FLOP inference access before claiming live earnings or an NFT sale.

Core files added: `lib/http-app.mjs`, `lib/agent-api.mjs`, `lib/hosted-mcp.mjs`, `lib/mcp-sessions.mjs`, `lib/action-schema.mjs`, `scripts/mcp-wallet.mjs`, `scripts/check-hosted-mcp.mjs`, `tests/hosted-mcp.test.mjs`. `server.mjs` now wires the shared HTTP/MCP handler to the existing workers. The original native transaction records and economic rules were preserved.

## Previous continuation record · November 7 (preview superseded above)

## Latest accepted rule

Offers are for **one specific NFT**, including an unlisted NFT. They are never bids for an entire collection. Both points and FLOP must be positive. Only the current NFT owner can accept. A completed settlement burns the buyer’s points, distributes FLOP 93% seller / 5% original creator / 2% Towa, and transfers only the target NFT. Other pieces remain independently owned and tradable. Collection size remains exactly 100.

No points expiry at launch. Points cannot be bought or transferred. The reference remains 1 point = 0.001 test FLOP. Collection creation starts at 1,000 points and doubles per creator; its FLOP contribution is the points’ reference value divided by nine, rounded up to a base unit.

## Running preview and agent interface

- Public origin: <https://cycles-evening-snow-aquarium.trycloudflare.com>
- The website has no sign-in gate. It reads the backend; agents act through the signed MCP/SDK.
- Agent guide: `/agent.md`; discovery: `/.well-known/agent-card.json`; API schema: `/openapi.json`.
- Download: `/downloads/towa-agent-0.3.0.tgz`, with adjacent `.sha256` checksum.
- Archive SHA-256: `576fedb27b99ece50301b3c9613bb8f8b20dbfc878dd173d389815c400bad106`.
- Node requirement: 24.5 or newer. Wallet keys stay in the agent sandbox.

This is a temporary Cloudflare tunnel, not persistent hosting. Current processes and origin are recorded privately in `data/preview-process.json` and `data/tunnel-process.json`. The backend’s configured origin is the public URL: signed clients and browser checks must use that exact origin. A localhost browser request with a different Origin is rejected deliberately.

## Checked results

- `npm test`: 33 passing tests, including rejection of collection/bundle bids, point reservations, duplicate-spend prevention, fee accounting and isolated settlement that leaves the other 99 NFTs unchanged.
- `npm run build`: frontend, API schema, portable MCP archive and checksum generated successfully.
- Archive installed in `/tmp/towa-agent-install-0.3.0-20261107`; encrypted test-wallet onboarding, installed MCP and SDK signed requests passed against an isolated in-memory backend. `outputs/package-smoke.json` records this check. The archive excludes local founder key-loading and server/database code.
- Public MCP joined the existing clone-01 identity, read state and quotes, and rejected collection bids and bids for nonexistent NFTs. No payments or inference were submitted by that smoke check. See `outputs/mcp-smoke.json`.
- Public browser checks passed desktop and mobile layouts, live counters, individual-offer labels, API documentation, download checksum and protected private routes, with no JavaScript errors. See `outputs/ui-smoke.json` and the desktop/mobile screenshots in `outputs/`.
- A consistent private backup was created before restarting the backend. Location: `data/backups/2026-11-07T14-17-29-044Z`. It includes the database and credential encryption key; do not publish it.

## Existing finalized transactions — do not repeat

These were already confirmed before this continuation. Their records remain in the live database.

| Action | Operation ID | Finalized block | Transaction |
|---|---|---:|---|
| Tower check-in | `ce7487fe-9e5b-453c-8e51-872b988a1cec` | 3,127,567 | [0x0fb0…6252](https://explorer.devnet.flop.network/extrinsic/0x0fb0f5ce1baa17322d9cec9e7c0232ed977b2709cd396bde826a8c2b68976252) |
| Native FLOP transfer | `d0ab4bc8-94c3-4a04-a59a-f1727ac8d5ac` | 3,127,992 | [0x1ed3…4dde](https://explorer.devnet.flop.network/extrinsic/0x1ed39b2fb5fa8860615d78fdd924f92f9b2cfc31317499228eef169dde7e4dde) |

The public ledger still has zero verified inference rewards, zero collections and zero NFT trades. Test fixtures were never written into it. The activity indexer is catching up from its durable cursor; do not reset the cursor forward and skip evidence.

## External blocker and remaining improvements

The prior main-wallet gateway credential returned HTTP 401 `api_key_expired`. A renewal attempt for that same wallet through Towa returned **“Wallet enrollment is temporarily unavailable.”** The backend saved that status, and the public page displays it. No replacement wallet was created, no quota was bypassed, and no inference or token transaction was retried. Wait for actual FLOP enrollment availability before submitting new bounded inference with a persistent request ID. Preserve existing request IDs and reconcile uncertain results.

Native FLOP payments are real; collectible ownership and point rules are maintained by Towa, not enforced by an NFT or smart-contract pallet. Offer points are held, but FLOP remains in the bidder’s wallet and is only balance-checked. It must not be described as escrow or an unconditional funded bid.

Next substantial improvements are a fixed public origin with durable hosting and restore drills, suitable escrow/custody if guaranteed bids are required, independent security review, and reward calibration against verified compute costs. See [every layer and improvements](architecture.md). The current daily reward cap makes the first collection require at least ten earning days; do not change prices or fabricate rewards merely to produce a live demonstration.
