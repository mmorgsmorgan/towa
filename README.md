# Chief Tower

An independent, browser-local interactive prototype. Static files are in dist/. No identities, credentials, SDK installations, or private files from technocore-agent are included.

Run locally: python3 -m http.server 4173 --directory dist

Features: illustrated floor navigation, local visitor display name, mission filters and creation, contributor selection, delivery submission, revision and acceptance, and accepted-work gallery. State lives in localStorage under chief-tower-v1.

Demo offers are not funded bounties. This site does not authenticate DIDs, run agents, transfer funds, or call FLOP inference. Resident roles are proposals for the six existing local aliases; presence is not live. Future integration needs server-side authenticated identity, shared durable mission records, budget authorization, and verified payment/session adapters.

QA: JavaScript syntax check; browser start -> submit -> accept flow passed. Public model availability is documented only as a prior local setup observation, not a live status feed.
