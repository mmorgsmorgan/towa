import { randomBytes, randomUUID } from 'node:crypto';
import Ajv from 'ajv';
import { sha256 } from './auth.mjs';
import { GENESIS } from './config.mjs';
import { registerAgent } from './ledger.mjs';
import { renewIntegration } from './presence.mjs';

const raw = { type: 'string', pattern: '^(0|[1-9][0-9]{0,38})$' };
export const mcpSessionSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 2, maxLength: 32 },
    did: { type: 'string', maxLength: 200 },
    ttlSeconds: { type: 'integer', minimum: 60, maximum: 3600, default: 900 },
    scopes: { type: 'array', minItems: 1, maxItems: 4, uniqueItems: true, items: { enum: ['read', 'trade', 'infer', 'enroll'] }, default: ['read'] },
    limits: {
      type: 'object', additionalProperties: false,
      properties: {
        maxPoints: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER, default: 0 },
        maxPaymentRaw: { ...raw, default: '0' },
        maxInferenceRaw: { ...raw, default: '0' },
        maxIntents: { type: 'integer', minimum: 1, maximum: 100, default: 25 },
      },
    },
  },
};
const validate = new Ajv({ strict: true }).compile(mcpSessionSchema);
const fail = (message, status = 403) => Object.assign(new Error(message), { status });

// Authorization sessions are independent of MCP transport sessions. Only token hashes
// are stored. No grant can mint another grant or extend its own lifetime.
export class McpSessions {
  constructor(store) {
    this.store = store;
    store.db.exec(`CREATE TABLE IF NOT EXISTS mcp_sessions (
      id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, address TEXT NOT NULL,
      origin TEXT NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER, json TEXT NOT NULL
    ); CREATE INDEX IF NOT EXISTS mcp_sessions_owner ON mcp_sessions(address, expires_at);`);
  }

  issue(identity, origin, input = {}, now = Date.now()) {
    if (!validate(input)) throw fail('Invalid MCP session options. Use only documented scopes, lifetime, DID and limits.', 400);
    const scopes = input.scopes || ['read'];
    if (!scopes.includes('read')) throw fail('Every MCP session must include the read scope.', 400);
    const active = this.store.db.prepare('SELECT COUNT(*) AS total FROM mcp_sessions WHERE address=? AND revoked_at IS NULL AND expires_at>?').get(identity.address, now).total;
    if (active >= 8) throw fail('Revoke an existing MCP session before opening another (maximum eight active sessions).', 429);
    const limits = { maxPoints: 0, maxPaymentRaw: '0', maxInferenceRaw: '0', maxIntents: 25, ...input.limits };
    const agent = this.store.change(state => {
      const agent = registerAgent(state, identity.address, input.name, { did: input.did, signatureType: identity.signatureType, now: new Date(now).toISOString() });
      renewIntegration(state, identity.address, new Date(now).toISOString());
      return agent;
    });
    const session = {
      id: randomUUID(), address: identity.address, did: agent.did, signatureType: identity.signatureType,
      origin, genesis: GENESIS, scopes, limits, createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + (input.ttlSeconds || 900) * 1000).toISOString(),
      used: { points: 0, paymentRaw: '0', inferenceRaw: '0', intents: 0 }, intents: [],
    };
    const token = 'towa_' + randomBytes(32).toString('base64url');
    this.store.db.prepare('INSERT INTO mcp_sessions VALUES(?,?,?,?,?,NULL,?)').run(session.id, sha256(token), session.address, origin, Date.parse(session.expiresAt), JSON.stringify(session));
    // Expired proofs can no longer authenticate; retain a bounded recent audit window.
    this.store.db.prepare('DELETE FROM mcp_sessions WHERE expires_at < ?').run(now - 7 * 86400000);
    return { access_token: token, token_type: 'Bearer', session: this.public(session), mcpUrl: origin + '/mcp' };
  }

  public(session) {
    const { intents, signatureType, ...visible } = session;
    return visible;
  }

  authenticate(authorization, origin, now = Date.now()) {
    if (typeof authorization !== 'string' || !/^Bearer towa_[A-Za-z0-9_-]{43}$/.test(authorization)) throw fail('A wallet-authorized MCP Bearer session is required. See /agent.md.', 401);
    const row = this.store.db.prepare('SELECT id FROM mcp_sessions WHERE token_hash=?').get(sha256(authorization.slice(7)));
    if (!row) throw fail('Unknown MCP session. Sign a new session request with your wallet.', 401);
    return this.active(row.id, origin, now);
  }

  active(id, origin, now = Date.now()) {
    const row = this.store.db.prepare('SELECT * FROM mcp_sessions WHERE id=?').get(id);
    if (!row || row.revoked_at !== null || row.expires_at <= now || row.origin !== origin) throw fail('MCP session expired, revoked, or issued for another origin. Sign a new session request.', 401);
    const session = JSON.parse(row.json);
    if (session.genesis !== GENESIS) throw fail('MCP session belongs to another network.', 401);
    return session;
  }

  authorize(session, scope, now = Date.now()) {
    const current = this.active(session.id, session.origin, now);
    if (!current.scopes.includes(scope)) throw fail(`This MCP session does not allow ${scope}. A wallet signature is required to change its permissions.`);
    return current;
  }

  // Reserve the requested upper limits before an asynchronous backend call. These
  // delegation counters never refund, even on failure, so crashes and concurrent
  // requests cannot replenish a credential's spending authority. Actual points are
  // separately reserved/refunded by the economy. Replays reuse the original charge.
  reserve(session, scope, { key, fingerprint, points = 0, paymentRaw = '0', inferenceRaw = '0' }, now = Date.now()) {
    this.store.db.exec('BEGIN IMMEDIATE');
    try {
      const current = this.authorize(session, scope, now);
      const previous = current.intents.find(intent => intent.key === key);
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw fail('This requestId already authorizes different arguments.', 409);
        if (points > previous.points || BigInt(paymentRaw) > BigInt(previous.paymentRaw) || BigInt(inferenceRaw) > BigInt(previous.inferenceRaw)) throw fail('The action exceeds its original delegated limits.');
      } else {
        const used = {
          points: BigInt(current.used.points) + BigInt(points),
          paymentRaw: BigInt(current.used.paymentRaw) + BigInt(paymentRaw),
          inferenceRaw: BigInt(current.used.inferenceRaw) + BigInt(inferenceRaw),
          intents: current.used.intents + 1,
        };
        if (used.points > BigInt(current.limits.maxPoints) || used.paymentRaw > BigInt(current.limits.maxPaymentRaw) || used.inferenceRaw > BigInt(current.limits.maxInferenceRaw) || used.intents > current.limits.maxIntents) throw fail('This action exceeds the remaining MCP session spending or intent limit.');
        current.used = { points: Number(used.points), paymentRaw: used.paymentRaw.toString(), inferenceRaw: used.inferenceRaw.toString(), intents: used.intents };
        current.intents.push({ key, fingerprint, points, paymentRaw, inferenceRaw });
        this.store.db.prepare('UPDATE mcp_sessions SET json=? WHERE id=?').run(JSON.stringify(current), current.id);
      }
      this.store.db.exec('COMMIT');
      return this.public(current);
    } catch (error) { this.store.db.exec('ROLLBACK'); throw error; }
  }

  list(address, origin) {
    return this.store.db.prepare('SELECT json, revoked_at FROM mcp_sessions WHERE address=? AND origin=? ORDER BY expires_at DESC').all(address, origin)
      .map(row => ({ ...this.public(JSON.parse(row.json)), revokedAt: row.revoked_at === null ? null : new Date(row.revoked_at).toISOString() }));
  }

  revoke(address, id, origin, now = Date.now()) {
    const row = this.store.db.prepare('SELECT address, origin FROM mcp_sessions WHERE id=?').get(id);
    if (!row || row.address !== address || row.origin !== origin) throw fail('This MCP session does not belong to the signing agent.');
    this.store.db.prepare('UPDATE mcp_sessions SET revoked_at=COALESCE(revoked_at,?) WHERE id=?').run(now, id);
    return { id, revoked: true };
  }
}
