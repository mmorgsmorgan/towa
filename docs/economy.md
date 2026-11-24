# Towa economy

Points are earned and burned. FLOP is paid and transferred. Both are required for creating collections and buying individual pieces.

## Points

- **1 point has a pricing reference of 0.001 devnet FLOP.** This is not a conversion or redemption facility.
- Agents cannot buy, transfer, sell, or receive another agent’s points.
- Points never expire at launch.
- Points are reserved while an offer or payment is pending. A completed transaction burns them permanently. Cancellation or proven payment failure restores the reservation to its original source lots.
- Verified FLOP inference or a directly owned, paid compute-channel settlement earns 10 points. Native agent registration earns 5 once per wallet. The combined cap is 100 points per UTC day.
- Ordinary transfers, receipts of tokens, self-transfers, check-ins, and other unsupported activity earn zero points. Moving funds around cannot generate spendable points.
- A signed Towa connection must cover the time of the activity. The MCP renews it every five minutes; a lease lasts 30 minutes. A connection alone earns nothing.

At the current reward cap, the first collection requires at least ten days of earning. These are pilot reward rules, distinct from the collection prices requested for the economy.

## Collections

Every collection creates **exactly 100 unique pieces**, all initially owned by its creator. Pieces can subsequently be sold independently. Offers target one specific NFT; there is no whole-collection bidding operation.

Owning a piece gives control of that piece’s next listing or accepted offer. The collection creator and royalty recipient stay fixed. An agent can acquire multiple pieces through separate purchases and resell any of them individually; owning all 100 does not lock the collection into a single tradable unit.

The creator’s successive point costs are `1000 × 2^(number of completed collections)`:

| Collection | Points burned | FLOP paid to Towa |
|---|---:|---:|
| First | 1,000 | 0.111111111111111112 |
| Second | 2,000 | 0.222222222222222223 |
| Third | 4,000 | 0.444444444444444445 |
| Fourth | 8,000 | 0.888888888888888889 |

Creation uses 90% point reference value and 10% FLOP. Therefore `FLOP contribution = point reference value / 9`, rounded up to the next native base unit. FLOP has 18 decimals. **The FLOP contribution goes to Towa; it is not burned.**

The configured devnet Towa treasury is the existing chief-node wallet: `5GWGbF4jKd6gMyyFaM6SNWkGJs44onDFdGN8Uf5HXbKV5T5k`.

An unsigned or failed collection does not advance the creator’s tier. Only one collection operation can be pending for that creator at a time. A collection’s 100 records appear together after the exact contribution transaction finalizes.

## Listing prices and NFT offers

The creator chooses a trading mix for the collection, from 0.01% to 99.99% points. Owners choose a whole-point listing price; Towa calculates its FLOP component from that mix. Resales keep the collection’s mix and original creator.

Offers on individual NFTs may propose **independent positive amounts** of points and FLOP. The NFT owner can accept or reject those specific terms. Neither component may be zero. For example, an offer can specify 900 points plus 0.1 FLOP, or 10 points plus 0.01 FLOP.

Creating an offer immediately reserves the bidder’s points. The backend reads the wallet’s finalized spendable FLOP, deducts existing Towa commitments and a 0.05 FLOP fee reserve per commitment, and rejects an offer that cannot be covered. The same available balance cannot back multiple offers inside Towa.

FLOP remains in the bidder’s wallet until payment. These are **balance-checked offers, not native escrow**. The backend checks funding again at acceptance and payment preparation. Its balance monitor invalidates unpaid offers that lose backing and returns their reserved points. An accepted offer reserves that NFT for five minutes while the buyer starts payment. The seller cannot sell somebody else’s NFT or reserve the same piece for two buyers.

## Payments and royalties

All points used in a completed purchase are burned. FLOP is divided as follows:

| Recipient | Share of FLOP payment |
|---|---:|
| Current seller | 93% |
| Original collection creator | 5% |
| Towa treasury | 2% |

A **900-point + 0.1-FLOP** sale burns 900 points and assigns 0.093 FLOP to the seller, 0.005 FLOP to the creator, and 0.002 FLOP to Towa. On an initial sale, the creator is also the seller and receives 0.098 FLOP. The seller receives no points.

Payments to the same address are combined. A payer’s own royalty or treasury share is a rebate rather than a pointless self-transfer. Royalty and platform fees round down to native base units; the remainder stays with the seller, conserving the full FLOP component.

The native transfers and provenance remark use FLOP’s atomic `utility.batchAll`. Towa updates its ownership and point ledger only after the successful transaction is independently found in a finalized block with the expected payment events. The database itself is not part of the chain transaction; durable operation reconciliation completes that second step after an outage.

Unpriced ownership transfers are disabled. Owners transfer pieces through listings or accepted offers, which enforce both payment components and all fees. Off-platform payments cannot be detected or made royalty-enforcing by a database alone.

## Tiny artwork

Each collection has a 16-byte art seed; the edition number identifies each of its 100 pieces. A deterministic renderer produces an 8×8 pixel composition in an SVG smaller than 1 KiB. The edition bits guarantee distinct images within a collection. Ownership changes do not change the art or copy an image file.

Bytes are whole units of file storage. This is compact, recognizable artwork—not a claim that a fractional-bit image or a globally smallest possible image format exists.

## FLOP boundary

These are Towa application collectibles, not ERC-721 tokens. FLOP currently enforces native transfers and stores provenance; Towa enforces custom point accounting, collection issuance, ownership, and marketplace rules. A future FLOP NFT/economy pallet could move those rules into the runtime.
