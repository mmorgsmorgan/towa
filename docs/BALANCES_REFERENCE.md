# Balances: verified reference for Tower

Checked 7 November 2026 using the artist's website, the official Exchange whitepaper, Sourcify-verified Ethereum source, and read-only mainnet calls. No transactions were sent.

**Original:** tradable Credits → burn 80 → tradable Statement → permanently surrender/lock → transferable BALANCE → a permanent wallet-bound artwork that displays the wallet's current balance. **Tower's proposed reversal:** nontransferable earned balance → burn → a separately tradable artwork. The reversal applies to the relationship between the transferable units and the wallet-bound artwork; earned participation is a new Tower rule, not how the original Credits were rated. [Whitepaper §§1–5][paper] [Credits project][credits-site]

## Verified contracts

All four user-supplied addresses are listed in whitepaper §9. Sourcify returned `exact_match` for both creation and runtime bytecode on Ethereum, chain ID 1. The BALANCE deployment is specifically `InterfaceAuctionWithdrawals`, inheriting `LineageWithdrawals`; its token name is Balances and symbol is BALANCE. The artwork is a separate ERC-721 with the same name/symbol. [Whitepaper §9][paper] [Verified source APIs][balance-source]

| Role | Address | Verified Solidity contract |
| --- | --- | --- |
| Credits | `0x97630aA70AB14ed9883B41dAfccBc11349723043` | [`Credits`][credits-source] |
| Statements | `0x75Edd94b7e49b3bD5C8047b91F165A5e265a069b` | [`Statements`][statements-source] |
| BALANCE units | `0x3620540c994433D7B4a628C46d2ED5F92572eA07` | [`InterfaceAuctionWithdrawals`][balance-source] |
| Wallet artwork | `0x3F2BA6C00c386986686A429c52099AaCD51b7e38` | [`LineageArtwork`][art-source] |
| Balance/WITHDRAWN renderer | `0x45149E17D5e11e904ffcD69Bba95d699dFB69A5c` | [`SurrenderedBalanceRenderer`][renderer-source] |

Read-only calls independently confirmed the deployment links: `Statements.credits()` returns the Credits address; `BALANCE.statements()` and `BALANCE.artwork()` return the addresses above; `LineageArtwork.token()` returns BALANCE; `BALANCE.renderer()` returns the renderer above. The renderer also has exact creation/runtime matches. [Contract read interfaces][balance-read] [Renderer verification][renderer-source]

## Actual mechanics

- **Credits are individually transferable ERC-721 artworks.** An owner-controlled distribution created one per eligible $8 X Money payment, from a 21-character payment ID and payment timestamp. SHA-256 supplies four 8×8 plates; `paidAt % 15 + 1` chooses the nonempty CMYK plate mask. `seal()` permanently closes distribution. Live reads returned `isSealed() = true` and original `supply() = 122154`. This counter records the original issuance and is not reduced by burns. Sources: `Credits.distribute`, `seal`, `burn`, `CreditDrawing.platesAt`; the [project page][credits-site] and [whitepaper §2][paper].
- **Composition burns exactly 80 Credits.** `Statements.compose(uint256[80], ...)` calls `credits.burn(msg.sender, ids)` and mints one Statement. The chosen order becomes an 8×10 page. Seeds, timestamps and the original IDs remain readable after burning. The original 122,154 edition permits at most 1,526 complete pages with 74 Credits left over; standalone burns can lower the attainable maximum. Sources: [`Statements._compose`, `composedFrom`, `recordOf`][statements-source]; [whitepaper §2][paper].
- **Overprinting is a second genuine burn.** `overprint(baseId, topId)` unions ink positions, adds the top page's score and history to the base, and burns the top token. The base keeps its identity and format. Black paper begins at the eighth constituent page. The ink remembers occupied positions, not how often an overlapping mark was printed. Sources: [`Statements.overprint`, `historyOf`, `INVERTED_AT`][statements-source]; [whitepaper §2][paper].
- **Ratings measure fixed edition rarity, not reputation, labor, price or appraised quality.** Five traits are palette, active bits, occupied cells, eights and print; eights have double weight. The fixed edition distribution maps rarity to 80–800 points, stored to four decimal places. A Statement sums all constituent Credit scores, including overprints. Sources: [rating methodology v4.0.0][rating]; [`CreditScore` and `Statements.creditScoreOf`][statements-source]; [whitepaper §2][paper].
- **Conversion initially locks the Statement; it does not burn it.** `withdraw(id, expectedAmount)` requires the actual owner, checks the reviewed quote, records issuance, transfers the NFT to the reserve, selects the WITHDRAWN renderer, and releases tokens. No return/redemption path exists for an issued Statement. Approval or a raw NFT transfer alone releases nothing. Later, `overprintWithdrawn(id)` can burn a surrendered top page into the first locked withdrawal, retaining cumulative lineage and releasing no additional tokens. Only accidental deposits with no issuance receipt have a limited recovery path. Sources: [`LineageWithdrawals.withdraw`, `overprintWithdrawn`, `recoverUnissuedStatement`][balance-source]; [whitepaper §3][paper].
- **One rating point releases one BALANCE from an existing reserve.** Four-decimal integer scores multiply by `SCORE_TO_TOKEN = 1e14` to become 18-decimal units. The deployment pre-minted 53,752,386.7072 BALANCE to itself once. A one-time retirement burned 2,386.7072 from creator-held converted units, leaving **53,750,000 total supply**, including unreleased reserve. Conversion does not mint; returning tokens to the reserve does not restore conversion rights. Sources: [`LineageWithdrawals` constructor, `quote`, `unreleasedSupply`; `InterfaceAuctionWithdrawals.retireLaunchSupply`][balance-source]; [whitepaper §3][paper].
- **CMYK quantities travel proportionally.** On withdrawal, the Statement's occupied CMYK plate bits determine the initial allocation. Subsequent transfers take a proportional share of the sender's current four quantities and combine it with the recipient's quantities. `InkMath.split` uses largest-remainder integer allocation, with ties C→M→Y→K, conserving the transferred total. Thus 25 sent from 100 units with an 80:20 cyan:magenta mixture carries 20 cyan and 5 magenta. This is aggregate ancestry, not token-by-token identity, individual Statement provenance, or inferred intent. Colors follow custody addresses, so a shared pool manager combines mixtures across pools. Sources: [`LineageWithdrawals._update`, `InkMath.count`, `InkMath.split`][balance-source]; [whitepaper §5][paper].
- **Wallet artwork is automatically issued and cannot be sold, transferred, approved or burned.** First positive receipt creates one ERC-721 per eligible address, in receipt order. It persists when the fungible balance reaches zero. Contracts and pools receive artworks too; the token reserve and zero address are excluded. Issuance uses `_mint` without an ERC-721 recipient callback. `locked()` is always true for an existing artwork; approval methods and subsequent NFT updates revert. Sources: [`LineageArtwork._issue`, `_update`, `locked`, `balanceChanged`][art-source]; [whitepaper §4][paper].
- **Metadata and drawing come from contract state.** `LineageArtwork.tokenURI` encodes self-contained JSON and SVG data URIs. `svg` passes the holder's current token amount and CMYK weights to the immutable token's renderer; `StatementBalanceRenderer` draws pixel numerals and the CMYK underline without hosted images or fonts. Artwork amounts truncate to two decimals; zero is `0`, positive dust is `<0.01`, and the metadata Balance trait keeps the exact amount. ERC-4906 updates notify indexers; marketplace caches can lag. History and color percentages are aggregate measures and do not establish distinct people or intentions. Sources: [`LineageArtwork.tokenURI`, `svg`, `contractURI` and `StatementBalanceRenderer`][art-source]; [whitepaper §4][paper].

Read-only state near Ethereum block **26,362,781** on 7 November 2026 corroborated `totalSupply = 53,750,000 × 10^18`, `totalRetired = 2,386.7072 × 10^18`, `ready = true`, `fundingPhase = 3`, and `transfersOpenBlock = 26,241,565`. These are dated observations, not continuous monitoring. [Read interface][balance-read] [Nearby block][check-block]

## Mismatches and limits

- The supplied four addresses are correct. Calling the entire process “burn art into tokens” misses the distinction: Credits and overprinted top Statements burn; conversion first locks its Statement. [Whitepaper §§2–3][paper] [Source][balance-source]
- 53,752,386.7072 is the original reserve, **not** final post-retirement total supply. Source comments on the base contract and older plans can otherwise mislead; the deployed specialization and live supply agree with the whitepaper. [Whitepaper §3][paper] [Source][balance-source]
- The wallet-art metadata still embeds `https://jack.art/credits/balances/`, but that route returned `Not found` during this check. The current whitepaper links Exchange at `https://jack.art/exchange/`. The official whitepaper is **`https://jack.art/credits/whitepaper`**, not a PDF path. [Artist's Credits note][artist-note] [Whitepaper][paper] [Embedded metadata source][art-source]
- Whitepaper v1.2 is labeled 23 October 2026, while one illustrative paragraph says “as of October 24, 2026.” Treat that paragraph's 563 Statements / 45,040 burned Credits as a dated illustration, not a current count or a perfectly synchronized revision. The example Balance #3 images are expressly local-rehearsal outputs, not mainnet evidence. [Whitepaper §§1,4,9][paper]
- Exact source/bytecode matching establishes which code is deployed; this reference is not an independent security audit. No public official repository was established; the source evidence here is the verified deployed compilation from Sourcify and Etherscan.

## Implications for Tower — design inference, not original Balances behavior

Tower can preserve the original's useful idea that visible art follows explicit, verifiable state transitions, while reversing what is transferable. The earned amount and its provenance remain with the earner until voluntarily consumed. A single authorized transition should deduct that amount and issue a transferable artwork atomically; the art can retain the consumed amount, its source categories and creator in permanent metadata. Subsequent artwork transfers should not transfer, replenish, or recreate earned balance. These are proposed Tower rules, not claims about Jack Butcher's contracts.

## Sources

- [Official Exchange whitepaper v1.2][paper]
- [Official Credits project][credits-site]
- [Official rating methodology][rating]
- [Artist's Credits note, 5 November 2026][artist-note]
- [Credits — verified source][credits-source]
- [Statements — verified source][statements-source]
- [BALANCE — verified source][balance-source]
- [Wallet artwork — verified source][art-source]
- [Renderer — verification][renderer-source]
- [BALANCE — Etherscan code][balance-code] and [read interface][balance-read]

[paper]: https://jack.art/credits/whitepaper
[credits-site]: https://jack.art/credits
[rating]: https://jack.art/credits/rating
[artist-note]: https://jack.art/notes/credits
[credits-source]: https://sourcify.dev/server/v2/contract/1/0x97630aA70AB14ed9883B41dAfccBc11349723043?fields=sources,compilation,metadata,abi
[statements-source]: https://sourcify.dev/server/v2/contract/1/0x75Edd94b7e49b3bD5C8047b91F165A5e265a069b?fields=sources,compilation,metadata,abi
[balance-source]: https://sourcify.dev/server/v2/contract/1/0x3620540c994433D7B4a628C46d2ED5F92572eA07?fields=sources,compilation,metadata,abi
[art-source]: https://sourcify.dev/server/v2/contract/1/0x3F2BA6C00c386986686A429c52099AaCD51b7e38?fields=sources,compilation,metadata,abi
[renderer-source]: https://sourcify.dev/server/v2/contract/1/0x45149E17D5e11e904ffcD69Bba95d699dFB69A5c?fields=compilation
[balance-code]: https://etherscan.io/address/0x3620540c994433D7B4a628C46d2ED5F92572eA07#code
[balance-read]: https://etherscan.io/address/0x3620540c994433D7B4a628C46d2ED5F92572eA07#readContract
[check-block]: https://etherscan.io/block/26362781
