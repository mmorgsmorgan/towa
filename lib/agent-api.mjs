import { agentFor, registerAgent, prepareOperation, releaseOperation, publicSession, expirePreparations } from './ledger.mjs';
import { createBid, acceptBid, cancelBid, bidFor } from './bids.mjs';
import { validateOfferInput } from './offer-input.mjs';
import { renewIntegration } from './presence.mjs';
import { collectionQuote, ECONOMY } from './economics.mjs';
import { PAYMENT_TYPES } from './amounts.mjs';

export function safeOperation(operation) {
  if (!operation) return null;
  const { rawExtrinsic, requestHash, ...safe } = operation;
  return safe;
}

// Only verified HTTP identities or server-bound MCP grants call this dispatcher.
// It accepts no acting address from a tool's arguments or a request body.
export function createAgentApi({ store, chain, inference }) {
  return async function agentApi(identity, method, path, input = {}, guard = () => {}) {
    guard();
    const address = identity.address;
    if (method === 'POST' && path === '/v1/agents') return store.change(state => {
      const agent = registerAgent(state, address, input.name, { did: input.did, signatureType: identity.signatureType });
      renewIntegration(state, address); return agent;
    });
    const agent = agentFor(store.read(), address);
    if (agent.onboardedAt) store.change(state => renewIntegration(state, address));
    if (method === 'POST' && path === '/v1/presence') return store.change(state => renewIntegration(state, address));
    if (method === 'GET' && path === '/v1/economy/quote') return { economy: ECONOMY, nextCollection: collectionQuote(store.read(), address) };
    if (method === 'GET' && path === '/v1/agents/me') {
      const state = store.read();
      return { agent: agentFor(state, address), gateway: inference.allowance(address), sessions: state.sessions.filter(s => s.actor === address), operations: state.operations.filter(o => o.actor === address).map(safeOperation), bids: state.bids.filter(b => [b.buyer, b.seller].includes(address)), activities: state.activities.filter(a => a.actor === address).slice(-100), indexer: state.indexer };
    }
    if (method === 'POST' && path === '/v1/bids') {
      validateOfferInput(input);
      const funding = await chain.funding(address); guard();
      return store.change(state => createBid(state, address, input, new Date().toISOString(), funding));
    }
    const bidMatch = path.match(/^\/v1\/bids\/([a-zA-Z0-9_-]+)(\/(accept|cancel))?$/);
    if (bidMatch) {
      const bid = bidFor(store.read(), bidMatch[1]);
      if (![bid.buyer, bid.seller].includes(address)) throw Object.assign(new Error('Private offer details belong to its buyer and seller. Use the public state for market terms.'), { status: 403 });
      if (method === 'GET' && !bidMatch[2]) return bid;
      if (method === 'POST' && bidMatch[3] === 'accept') {
        if (bid.seller !== address) throw Object.assign(new Error('Only the NFT owner can accept this offer.'), { status: 403 });
        const funding = await chain.funding(bid.buyer); guard();
        return store.change(state => acceptBid(state, address, bid.id, new Date().toISOString(), funding));
      }
      if (method === 'POST' && bidMatch[3] === 'cancel') return store.change(state => cancelBid(state, address, bidMatch[1]));
    }
    if (method === 'POST' && path === '/v1/gateway/challenge') return inference.challenge(address);
    if (method === 'POST' && path === '/v1/gateway/enroll') return inference.enroll(address, input);
    if (method === 'POST' && path === '/v1/inferences') return inference.create(address, input);
    const sessionMatch = path.match(/^\/v1\/inferences\/([a-zA-Z0-9_-]+)(\/reconcile)?$/);
    if (sessionMatch) {
      let session = store.read().sessions.find(s => s.id === sessionMatch[1]);
      if (!session) throw Object.assign(new Error('Inference not found.'), { status: 404 });
      if (method === 'POST' && sessionMatch[2]) {
        if (session.actor !== address) throw Object.assign(new Error('Only the requesting agent can refresh this receipt.'), { status: 403 });
        session = await inference.reconcileOne(session.id);
      } else if (method !== 'GET') throw new Error('Unsupported inference action.');
      return session.actor === address ? session : publicSession(session);
    }
    if (method === 'POST' && path === '/v1/operations') {
      store.change(state => expirePreparations(state));
      const funding = PAYMENT_TYPES.includes(input.type) ? await chain.funding(address) : undefined; guard();
      const operation = store.change(state => prepareOperation(state, address, input, new Date().toISOString(), funding));
      return { ...safeOperation(operation), ...(operation.status === 'prepared' ? { quote: await chain.quote(operation) } : {}) };
    }
    const opMatch = path.match(/^\/v1\/operations\/([a-zA-Z0-9_-]+)(\/(submit|abandon))?$/);
    if (opMatch) {
      const operation = store.read().operations.find(o => o.id === opMatch[1]);
      if (!operation) throw Object.assign(new Error('Operation not found.'), { status: 404 });
      if (operation.actor !== address) throw Object.assign(new Error('This operation belongs to another agent.'), { status: 403 });
      if (method === 'GET' && !opMatch[2]) return { ...safeOperation(operation), ...(operation.status === 'prepared' ? { quote: await chain.quote(operation) } : {}) };
      if (method === 'POST' && opMatch[3] === 'submit') return safeOperation(await chain.submit(store, operation.id, address, input.extrinsic));
      if (method === 'POST' && opMatch[3] === 'abandon') return safeOperation(store.change(state => releaseOperation(state, operation.id, 'Cancelled before signing.', 'cancelled')));
    }
    throw Object.assign(new Error('Endpoint not found.'), { status: 404 });
  };
}
