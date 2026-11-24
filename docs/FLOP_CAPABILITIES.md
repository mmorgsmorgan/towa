# FLOP and the reverse-Balances design

Checked against FLOP devnet runtime **1014014**, genesis `0x99c172c095340ace980631f9123544c6bebd4839f3437e463533422d8be2d631`, on November 7, 2026. The exact observed call metadata is retained in `outputs/runtime-capabilities.json`.

| Requirement | Existing FLOP capability | Boundary |
|---|---|---|
| General-purpose application contracts | Fixed native runtime pallets | No user-deployable EVM, `contracts`, or `revive` pallet was present. New runtime logic needs governance. |
| ERC-721-like art ownership | No general NFT pallet observed | Neither `nfts` nor `uniques` was present. A database entry plus a remark is not a chain-enforced NFT. |
| Transfer and sale of native assets | `balances.transferKeepAlive`; compute-forward position/holder rights | Compute-forward rights represent economic rights in actual compute contracts, not arbitrary art. |
| Atomic native compute-rights sale | `computeChannel.listForwardUnits` / `fillForwardListing` | Runtime metadata says fill atomically moves rights and pays the seller. Presence of calls does not establish public offers or admitted capacity. Public offer discovery returned none during this session. |
| Agent control | `agentIdentity`, `agentWallet`, `flopSessionKeys`, proxies and multisig | These identify agents and constrain capabilities; they do not provide collectible mint rules. |
| Content commitments | `system.remarkWithEvent`, `daRegistry.registerBlob` | A provenance statement or stored blob does not make the chain enforce item ownership. DA also has deposits, retention and admission conditions. |
| Grouped payment and proof | `utility.batchAll` | All included native calls succeed together or roll back. The external Tower database is not part of that chain transaction. |

Tower implements the requested direction: verified inference earns a nontransferable balance; a voluntary spend/burn issues a transferable work piece. No tradable points token or token reserve is needed. A piece preserves its burned quantity and originating inference IDs. The deterministic creation artwork stays fixed; the metadata reads the current owner and transfer history from Tower.

FLOP's chain verifies the native payments and anchors provenance records. Tower verifies receipts, checks finalized events, prevents duplicate rewards and double sales, and maintains collectible ownership in SQLite. Calling the result an ERC-721 or a wholly chain-native NFT would be inaccurate.

For a wholly chain-enforced version on FLOP, its maintainers would have to adopt a pallet implementing nontransferable earned balances, authorized inference awards, atomic burn-and-mint, item ownership and transfers, and atomic FLOP purchases. A user cannot add that pallet to the shared devnet by submitting an ordinary transaction.

Sources: [FLOP architecture FAQ](https://docs.flop.network/docs/technology-and-chain), [agent account documentation](https://docs.flop.network/docs/agent-accounts-and-spend-control), and the live runtime metadata captured above. See `BALANCES_REFERENCE.md` for the independently checked Jack Butcher reference.
