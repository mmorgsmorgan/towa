import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import Ajv from 'ajv';
import { sha256 } from './auth.mjs';
import { offerInputSchema } from './offer-input.mjs';
import { objectSchema, resourceIdSchema, inferenceInputSchema, operationInputSchema } from './action-schema.mjs';

const empty = objectSchema();
const operationId = objectSchema({ operationId: resourceIdSchema });
const tool = (name, description, inputSchema = empty, readOnly = false) => ({ name, description, inputSchema, annotations: { readOnlyHint: readOnly, destructiveHint: !readOnly, openWorldHint: true } });
export const hostedTools = [
  tool('tower_state', 'Read the public live economy, collections, individual NFT listings and offers. No wallet or session required.', empty, true),
  tool('tower_session', 'Read this wallet-authorized session, its permissions, expiry and remaining delegation limits. A session cannot extend or upgrade itself.', empty, true),
  tool('tower_join', 'Read the account created by the wallet-signed session request and renew its active connection. Does not accept an acting address or DID.'),
  tool('tower_presence', 'Renew recent activity for this authenticated agent. Call every five minutes while using Towa. Heartbeats alone earn no points.'),
  tool('tower_me', 'Read only this authenticated agent’s private account, receipts, operations and offers.', empty, true),
  tool('tower_quote', 'Read the exact next collection cost. Exactly 100 pieces, starting at 1000 earned points and doubling per creator, plus the 10% FLOP contribution.', empty, true),
  tool('tower_enrollment_challenge', 'Obtain the FLOP gateway enrollment message for this existing wallet. Validate and sign it locally, then call tower_enroll. Never send wallet keys. Requires enroll scope.'),
  tool('tower_enroll', 'Submit the FLOP enrollment message and its LOCAL wallet signature. The server never signs it. Respect FLOP capacity and wallet quotas.', objectSchema({ message: { type: 'string', maxLength: 2000 }, signature: { type: 'string', pattern: '^0x[0-9a-fA-F]{128,132}$' } })),
  tool('tower_infer', 'Submit one bounded real inference using a saved requestId. Requires infer scope and remaining inference allowance. Only verified work earns points; reconcile the original ID after a timeout.', inferenceInputSchema),
  tool('tower_receipt', 'Reconcile an existing inference belonging to this agent without submitting new work.', objectSchema({ requestId: { type: 'string', pattern: '^tower-[a-zA-Z0-9_-]{12,100}$' } })),
  tool('tower_bid', 'Offer positive points AND FLOP for ONE NFT by itemId, including an unlisted NFT. Reserves earned points and verifies finalized spendable FLOP; FLOP is not escrowed. Requires trade scope. Save requestId.', offerInputSchema),
  tool('tower_offer_action', 'Read, accept or cancel an individual NFT offer. Only the current seller can accept; either party can close an unpaid offer. Mutations require trade scope.', objectSchema({ bidId: resourceIdSchema, action: { enum: ['read', 'accept', 'cancel'] } })),
  tool('tower_prepare', 'Prepare an exact unsigned native transaction; this tool DOES NOT sign or pay. Save requestId and your original intent locally. Validate the returned operation and all recipients with a local wallet adapter, sign locally, then call tower_submit. Supports mint-collection, list, buy, settle-bid, cancel, send and check-in. Requires trade scope and remaining point/payment limits.', operationInputSchema),
  tool('tower_submit', 'Submit the already locally signed transaction for a saved operation. The backend verifies the signer, exact call and finality before burning points or transferring ownership. Retry only this operation and these signed bytes. Requires trade scope.', objectSchema({ operationId: resourceIdSchema, extrinsic: { type: 'string', pattern: '^0x(?:[0-9a-fA-F]{2})+$', maxLength: 32000 } })),
  tool('tower_operation', 'Recover an operation owned by this agent, including an unsigned quote while prepared. Poll submitted operations until finality. Never replace an uncertain payment with a new requestId.', operationId, true),
  tool('tower_abandon', 'Release an unsigned preparation owned by this agent. Submitted payments must resolve on-chain; they cannot be abandoned. Requires trade scope.', operationId),
  tool('tower_disconnect', 'Revoke ONLY the current MCP authorization session. Existing submitted transactions and reservations continue to reconcile. A fresh wallet signature is required to reconnect.'),
];
const ajv = new Ajv({ strict: true, allErrors: false });
const validators = new Map(hostedTools.map(definition => [definition.name, ajv.compile(definition.inputSchema)]));
const result = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
const failure = error => ({ isError: true, content: [{ type: 'text', text: String(error.message || 'Towa request failed.').slice(0,500) }] });

// Convert the JSON number sent to FLOP to an exact, conservatively rounded budget.
export function inferenceLimitRaw(value) {
  const [coefficient, exponent = '0'] = String(value).split('e');
  const [whole, fraction = ''] = coefficient.split('.');
  const digits = BigInt(whole + fraction), scale = 18 + Number(exponent) - fraction.length;
  if (scale >= 0) return (digits * 10n ** BigInt(scale)).toString();
  const denominator = 10n ** BigInt(-scale);
  return ((digits + denominator - 1n) / denominator).toString();
}

export function createHostedMcp({ sessions, store, agentApi, readPublicState }) {
  function operationIntent(input, address, operation) {
    if (input.type === 'settle-bid') {
      const bid = store.read().bids.find(b => b.id === (input.bidId || operation?.action.bidId));
      if (!bid || bid.buyer !== address) throw new Error('Only the buyer can prepare this NFT offer payment.');
      // The original offer and its payment represent one liability, not two burns.
      return { key: 'bid:' + bid.requestId, fingerprint: bid.requestHash, points: bid.pointsPrice, paymentRaw: bid.priceRaw };
    }
    return {
      key: 'operation:' + input.requestId,
      fingerprint: operation?.requestHash || sha256(JSON.stringify(input)),
      points: operation?.points ?? input.maxPoints ?? 0,
      paymentRaw: operation?.action.paymentRaw ?? input.maxPaymentRaw ?? input.amountRaw ?? '0',
    };
  }

  async function call(name, args, session) {
    const validate = validators.get(name);
    if (!validate) throw new Error('Unknown Towa tool.');
    if (!validate(args)) throw new Error(name === 'tower_bid' ? 'An offer targets one NFT using itemId. Use only the documented individual offer fields and positive amounts.' : 'Invalid tool arguments. Use the advertised schema; identities, wallet keys, balances and proofs are never tool inputs.');
    if (name === 'tower_state') return readPublicState();
    const grant = sessions.authorize(session, 'read');
    const scope = ['tower_prepare','tower_submit','tower_bid','tower_abandon'].includes(name) || (name === 'tower_offer_action' && args.action !== 'read') ? 'trade' : name === 'tower_infer' ? 'infer' : ['tower_enroll','tower_enrollment_challenge'].includes(name) ? 'enroll' : 'read';
    sessions.authorize(grant, scope);
    const identity = { address: grant.address, signatureType: grant.signatureType };
    const dispatch = (method, path, input) => agentApi(identity, method, path, input, () => sessions.authorize(grant, scope));
    if (name === 'tower_session') return sessions.public(grant);
    if (name === 'tower_disconnect') return sessions.revoke(grant.address, grant.id, grant.origin);
    if (name === 'tower_join' || name === 'tower_me') {
      const me = await dispatch('GET', '/v1/agents/me'); return name === 'tower_join' ? me.agent : me;
    }
    if (name === 'tower_presence') return dispatch('POST','/v1/presence',{});
    if (name === 'tower_quote') return dispatch('GET','/v1/economy/quote');
    if (name === 'tower_enrollment_challenge') return dispatch('POST','/v1/gateway/challenge',{});
    if (name === 'tower_enroll') return dispatch('POST','/v1/gateway/enroll',args);
    if (name === 'tower_infer') {
      sessions.reserve(grant, scope, { key: 'inference:' + args.requestId, fingerprint: sha256(JSON.stringify(args)), inferenceRaw: inferenceLimitRaw(args.maxCostFlop ?? 0.2) });
      return dispatch('POST','/v1/inferences',args);
    }
    if (name === 'tower_receipt') return dispatch('POST',`/v1/inferences/${args.requestId}/reconcile`,{});
    if (name === 'tower_bid') {
      sessions.reserve(grant, scope, { key: 'bid:' + args.requestId, fingerprint: sha256(JSON.stringify(args)), points: args.pointsPrice, paymentRaw: args.paymentRaw });
      return dispatch('POST','/v1/bids',args);
    }
    if (name === 'tower_offer_action') return dispatch(args.action === 'read' ? 'GET' : 'POST', `/v1/bids/${args.bidId}` + (args.action === 'read' ? '' : '/' + args.action), args.action === 'read' ? undefined : {});
    if (name === 'tower_prepare') {
      sessions.reserve(grant, scope, operationIntent(args, grant.address));
      return dispatch('POST','/v1/operations',args);
    }
    if (name === 'tower_submit') {
      const op = store.read().operations.find(o => o.id === args.operationId && o.actor === grant.address);
      if (!op) throw new Error('This operation is unavailable or belongs to another agent.');
      sessions.reserve(grant, scope, operationIntent({ type: op.type, requestId: op.requestId }, grant.address, op));
      return dispatch('POST',`/v1/operations/${args.operationId}/submit`,{ extrinsic: args.extrinsic });
    }
    if (name === 'tower_operation') return dispatch('GET',`/v1/operations/${args.operationId}`);
    if (name === 'tower_abandon') return dispatch('POST',`/v1/operations/${args.operationId}/abandon`,{});
    throw new Error('Unknown Towa tool.');
  }

  return async function handleMcp(req, res, body, origin) {
    const sendError = (status, message) => {
      if (status === 401) res.setHeader('WWW-Authenticate', 'Bearer realm="towa-mcp"');
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: body?.id ?? null, error: { code: -32000, message } }));
    };
    if (req.method !== 'POST') {
      res.setHeader('Allow','POST'); return sendError(405,'Use Streamable HTTP POST. This stateless endpoint has no standalone SSE stream; revoke credentials with tower_disconnect or the signed session API.');
    }
    if (req.url !== '/mcp' || req.headers['mcp-session-id']) return sendError(400,'Use the exact /mcp URL and Authorization header. Transport session IDs and URL credentials are not accepted.');
    if (Array.isArray(body)) return sendError(400,'JSON-RPC batches are not supported. Send one MCP request per POST.');
    if (body?.method === 'tools/call' && body.id === undefined) return sendError(400,'Tool calls must be JSON-RPC requests with an ID, not notifications.');
    let session;
    try {
      if ((req.headersDistinct?.authorization?.length || 0) > 1) throw Object.assign(new Error('Use one Authorization header.'), { status: 401 });
      if (req.headers.authorization) session = sessions.authenticate(req.headers.authorization, origin);
      if (body?.method === 'tools/call' && body.params?.name !== 'tower_state' && !session) throw Object.assign(new Error('Obtain a session through a wallet-signed POST /v1/mcp/sessions. See /agent.md.'), { status: 401 });
    } catch (error) { return sendError(error.status || 401, error.message); }

    // A new transport/server per request prevents mutable actor state from leaking
    // between concurrent agents. SQLite holds authorization and economic recovery.
    const server = new Server({ name: 'towa', version: '0.4.0' }, {
      capabilities: { tools: {} },
      instructions: 'Hosted Towa MCP. Authenticate with a short-lived wallet-authorized Bearer session. Keep keys and signing local. tower_prepare returns unsigned work; validate it against your saved intent locally, sign, then tower_submit. Points are earned and burned, FLOP is paid and transferred. Offers target one NFT. Preserve request IDs through failures. Call tower_presence every five minutes while active. Session expiry requires a fresh wallet proof; it never cancels submitted payments.',
    });
    server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: hostedTools }));
    server.setRequestHandler(CallToolRequestSchema, async request => {
      try { return result(await call(request.params.name, request.params.arguments || {}, session)); }
      catch (error) { return failure(error); }
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.once('close', () => { void server.close().catch(() => {}); });
    try { await server.connect(transport); await transport.handleRequest(req,res,body); }
    catch { if (!res.headersSent) sendError(500,'MCP transport failed. Reconcile any saved operation before retrying.'); }
  };
}
