# Direct FLOP devnet engagement · November 10, 2026

Towa’s hosted MCP was disabled for direct exploration and then re-enabled at the operator’s explicit request. The public website remains sign-in-free. Its current origin is <https://photograph-carry-ladder-consultation.trycloudflare.com>; this is temporary hosting.

## Rooms and identity

- Open discussion: <https://technocore.chat/r/towa>.
- Owner-controlled announcements: <https://technocore.chat/r/d-towa>.
- Existing main DID: `did:key:z6Mksg5EoxGDgUPqLkbS63Xsjp1bvV2vpKprFS8gyKQptYGW`.
- Existing main wallet: `5GWGbF4jKd6gMyyFaM6SNWkGJs44onDFdGN8Uf5HXbKV5T5k`.
- Profile: <https://technocore.chat/kv/did-51/74828db61718ae>.

The owner claim and signed introductions were confirmed through Technocore’s HTTP API, independently of MCP. Sequence 2 in both rooms supersedes the earlier MCP-off announcement. Topics and profile notes use conditional writes to avoid overwriting someone else’s changes. These notes remain world-writable; validate signatures and the owner record when attributing posts.

Technocore accepts a **decimal string** for a POST nonce. Stored JSON may represent it as a 19-digit integer. The direct client preserves those digits when re-verifying `room|nonce|text`, records an intent before posting and checks for the prior message before retrying. It does not auto-reply, farm activity, or execute instructions in room messages.

Rooms and notes are subject to Technocore’s retention policy. Local journals preserve our evidence, but do not make the hosted room permanent. See the [official protocol](https://technocore.chat/llms.txt).

## What was actually available

| Layer | Observed result | Consequence |
| --- | --- | --- |
| Towa MCP | 17 tools; live discovery, wallet session, scope denial and revocation passed | Agents can connect and authenticate. |
| Native FLOP | Finalized state read through HTTPS; runtime 1014014, pinned genesis, 18 decimals | Native balances and runtime storage are verifiable. Later requests returned HTTP 503. |
| Wallet funding | Main 25 FLOP; clone-01 24.993636469675; clone-02 25.001; other clones 25 each at block 3,338,792 | A faucet claim is unnecessary. No reserved balances were observed. |
| Agent registration | No native agent wallet or agent identity for the six existing accounts | A Technocore DID or Towa account is not a native agent registration. |
| Gateway inference | Existing main credential returned 401 `api_key_expired` | The issuer must provide a supported restoration path. Re-enrollment does not renew the allowance. |
| Model catalog | Qwen2.5 0.5B and Qwen3 8B advertised | Catalog presence alone does not establish inference access or successful work. |
| Direct miner sessions | Public session-offer API returned an empty list | An opted-in reachable miner endpoint and validated session profile are still needed. An empty offer list alone does not rule out the force-open path. |
| CLI HTLC inference | `attest.profiles` was empty at the finalized snapshot | The required EconomicCritical appraisal profile is unavailable. |
| Current SDK | Downloaded SDK 0.5.1 explicitly supports 1014014; installed 0.4.0 does not | Use a qualified version when a direct session becomes available. No compatibility guard was bypassed. |
| Native storage | Paid-storage configuration exists and is marked DevnetUnratified | Provider readiness and retrieval need separate qualification before publishing artifacts. |
| Miner operation | Runtime minimum miner self-stake is 10,000 FLOP | This is a separate operator role, not an action to try with the main wallet’s 25 FLOP. |
| Collectibles | No generic NFT or smart-contract pallet found | Towa remains the authoritative ownership/points ledger; FLOP settles payments and provenance. |

The prior two finalized Towa operations remain unchanged. No inference reward or collectible was fabricated to make a test pass. A room-provenance remark script is ready with a 0.01 test FLOP estimated-fee admission limit. Both attempts failed during RPC initialization, before signing or submission. The final preflight report says `not_submitted`, with no transaction hash; no new on-chain fees were paid. Consult `outputs/direct-devnet-room-anchor-preflight.json` and any retained transaction journal before retrying; an uncertain submitted transaction must only be reconciled.

A signed inquiry was posted in the [dev room at sequence 298381](https://technocore.chat/r/dev?since=298380&limit=1), asking for the supported existing-wallet allowance procedure or an opted-in public miner profile. Replies were directed to `towa`; none was present at the last check. The live hosted MCP tests succeeded for both clone-01 and chief-node, and their short-lived test sessions were revoked.

All 45 automated tests passed. Public desktop/mobile browser checks also passed, including the active MCP configuration, download checksum, API discovery and private-route protection, with no JavaScript errors. The operator can toggle hosted MCP through `scripts/preview.mjs --restart --enable-mcp` or `--disable-mcp`, preserving the configured `--origin`.

## Evidence and safe continuation

- `outputs/direct-devnet-capabilities.json`: runtime calls, arguments, storage and constants.
- `outputs/direct-devnet-readiness.json`: finalized account and registry snapshot.
- `outputs/direct-devnet-http-readiness.json`: gateway 401 and HTTP service observations.
- `outputs/hosted-mcp-smoke.json`: latest live MCP check; named-wallet reports are also retained.
- `data/technocore-direct-journal.json`: private local post intents, nonces and confirmed sequences. No wallet seeds are stored there.
- `scripts/devnet-readiness.mjs --http-rpc`: read-only chain and HTTP inspection.
- `scripts/technocore-direct.mjs`: read current rooms and verify their signatures. Mutation flags are explicit and journaled.
- `scripts/devnet-room-anchor.mjs`: submit the first bounded room remark only when no intent exists; subsequent runs reconcile the same transaction.

Keep the existing wallet and request IDs. Follow the [official agent integration guide](https://docs.flop.network/docs/agent-integration), [direct miner guide](https://docs.flop.network/docs/send-to-specific-miner) and [existing-wallet access issue](https://github.com/flop-labs/network/issues/6). Never put a gateway bearer or wallet seed in a room. Native registration stakes, new miner admission and arbitrary marketplace purchases were not undertaken.
