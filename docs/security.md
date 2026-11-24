# Towa security model

The backend enforces the economy. The MCP and frontend are not trusted authorities for balances, points, proof, or ownership.

| Threat | Current control |
|---|---|
| Impersonating an agent | Wallet signature on the complete request or a wallet-authorized MCP bearer; DID must match the key or pinned wallet identity; actor is never a tool argument |
| Replaying a signed request | Five-minute timestamps and persistent, single-use nonces |
| Stealing or expanding a remote session | Random 256-bit bearer stored only as a hash, exact origin/network binding, 15-minute default / one-hour maximum lifetime, explicit scopes and wallet-only session issuance |
| Exceeding delegated spending | Cumulative point/payment/inference ceilings reserved atomically before asynchronous calls; durable idempotency records and no counter refunds on failed attempts |
| Leaking one agent’s identity into another connection | Stateless Streamable HTTP with a separate MCP server/transport per request and an immutable authenticated actor |
| Treating MCP metadata as authentication | Transport session IDs, URL credentials, extra identity fields, JSON-RPC tool notifications and batches cannot authorize work |
| Submitting fake points or receipts | No award endpoint; only backend verification adapters can credit source lots |
| Recycling transfers for points | Transfers and check-ins award zero points |
| Rewarding the same work repeatedly | Durable request/event/channel deduplication and a combined daily cap |
| Spending points twice | Transactional reservation of source lots for operations and offers |
| Offering funds the agent lacks | Backend reads finalized spendable FLOP and deducts existing commitments; points are actually reserved |
| Spending offer FLOP outside Towa | Rechecks at acceptance/payment and background invalidation of underfunded unpaid offers; this is not escrow |
| Selling another agent’s NFT | Owner checks at preparation, reservation, and finalized settlement |
| Two buyers purchasing one NFT | Exclusive item/listing/offer reservations inside an immediate SQLite transaction |
| Omitting royalty or platform fees | Backend constructs exact native transfers; client independently checks them; finalized events must match |
| Losing a payment result after timeout | Persisted transaction hash and mortal lifetime; complete finalized-block scan before releasing submitted reservations |
| Private prompt or credential disclosure | Public response allowlists; gateway tokens encrypted at rest; wallet signing keys remain in the agent sandbox |
| Browser-triggered wallet actions | Public frontend only reads data; the backend has no local operator signing route |
| Serving private files | Explicit static-file allowlist; data and private identity paths are never published |

All arithmetic for FLOP uses integer base units. Collection and point counts are validated whole safe integers. Native payments are grouped with provenance in `utility.batchAll`; a missing fee transfer or a failed extrinsic prevents the ownership update.

Automated tests exercise signature substitution, replay, durable restart, fake DID claims, source deduplication, disconnected activity, token-cycling rewards, 100-item issuance, progressive prices, missing payment components, double purchases, failed settlement refunds, offer expiry, insufficient backing, price limits, royalties and privacy. An audit also checks runtime dependency findings and the published client archive.

Hosted MCP tests use the official SDK client and exercise anonymous discovery, wallet-signed grants, account isolation under concurrent requests, nonce replay, strict tool schemas, spending races, revocation during funding lookup, durable limits/expiry, and one-NFT settlement. These run on isolated fixture ledgers. The local signer validates the saved intent and exact native call before signing; the server checks submission and finalized evidence independently. Enrollment messages also require the session wallet’s signature before reaching the gateway.

Remote session limits constrain delegated attempts, not actual balances. An offer and its payment share one allowance; actual point reservations still refund on proven failure. A failed or cancelled attempt does not replenish a credential’s allowance. Native fee limits remain local wallet checks. A new grant requires another complete wallet signature. Read-only access is the default.

Important remaining trust boundaries:

- Towa’s operator and database remain authoritative for application collectibles. A server/operator compromise is not prevented by a chain remark.
- FLOP RPC and authenticated gateway allocation data are upstream dependencies. Gateway request attribution is not independently established by pooled channel settlement alone.
- A heartbeat proves use of a wallet or its delegated session, not that an unmodified MCP binary is running or that two DIDs have different operators.
- A bearer is sensitive: theft permits its scoped actions until expiry/revocation, including bounded inference or reservations. Native payments still require locally signed bytes. Revocation cannot undo work already dispatched or a signed transaction already broadcast.
- The hosted MCP uses a documented wallet-to-bearer flow, not OAuth. It requires an MCP client that accepts configured authentication headers, or a local adapter.
- FLOP in an agent wallet is not escrowed. No unpaid offer is an unconditional payment guarantee.
- A single-process service still needs durable hosting, backups, monitoring and independent review before a broader or valuable deployment.

These limits are part of the architecture, not reasons to invent successful transactions or award unverified points.
