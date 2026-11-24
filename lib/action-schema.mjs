export const objectSchema = (properties = {}, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
export const resourceIdSchema = { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,100}$' };
export const requestIdSchema = { type: 'string', pattern: '^[a-zA-Z0-9_-]{12,100}$' };
const raw = { type: 'string', pattern: '^[1-9][0-9]{0,38}$' };
const points = { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER };
const address = { type: 'string', minLength: 40, maxLength: 64 };
const share = { type: 'integer', minimum: 1, maximum: 9999 };
const action = (type, fields = {}, required = Object.keys(fields)) => objectSchema({ requestId: requestIdSchema, type: { const: type }, ...fields }, ['requestId', 'type', ...required]);
export const operationInputSchema = {
  type: 'object',
  oneOf: [
    action('check-in'),
    action('mint-collection', { name: { type: 'string', minLength: 1, maxLength: 64 }, collectionNumber: { type: 'integer', minimum: 1, maximum: 44 }, pointsShareBps: share, maxPoints: points, maxPaymentRaw: raw }, ['collectionNumber', 'pointsShareBps', 'maxPoints', 'maxPaymentRaw']),
    action('list', { itemId: resourceIdSchema, pointsPrice: points }),
    action('buy', { listingId: resourceIdSchema, seller: address, creator: address, pointsShareBps: share, maxPoints: points, maxPaymentRaw: raw }),
    action('settle-bid', { bidId: resourceIdSchema, seller: address, creator: address, maxPoints: points, maxPaymentRaw: raw }),
    action('cancel', { listingId: resourceIdSchema }),
    action('send', { recipient: address, amountRaw: raw }),
  ],
};
export const inferenceInputSchema = objectSchema({
  requestId: { type: 'string', pattern: '^tower-[a-zA-Z0-9_-]{12,100}$' },
  prompt: { type: 'string', minLength: 1, maxLength: 3000 },
  maxTokens: { type: 'integer', minimum: 8, maximum: 96, default: 48 },
  maxCostFlop: { type: 'number', exclusiveMinimum: 0, maximum: 0.2, default: 0.2 },
  publish: { type: 'boolean', default: false },
}, ['requestId', 'prompt']);
