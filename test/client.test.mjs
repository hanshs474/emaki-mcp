// Unit tests against the real response shapes of emaki.ai's API (mocked transport; no network).
import test from 'node:test';
import assert from 'node:assert/strict';
import { submit, getStatus, credits, waitFor, setFetch, EmakiError } from '../dist/client.js';

process.env.EMAKI_API_KEY = 'sk-test';
const reply = (status, body) => async () => new Response(JSON.stringify(body), { status });

test('submit returns the run', async () => {
  setFetch(reply(200, { success: true, data: { id: 'v1', status: 'generating' } }));
  assert.equal((await submit('a cat', 'nano_banana_2_lite')).id, 'v1');
});

for (const [status, body, kind] of [
  [401, { error: 'Invalid API key. Create one at https://emaki.ai/settings/apikeys' }, 'auth'],
  [402, { error: 'Insufficient credits' }, 'quota'],
  [403, { error: 'purchase required' }, 'plan'],
  [409, { error: 'Video generation is already in progress' }, 'busy'],
  [429, { error: 'cooldown', code: 'content_cooldown' }, 'rejected'],
  [400, { error: 'blocked', code: 'content_blocked' }, 'rejected'],
  [400, { error: 'duration must be 4-30' }, 'validation'],
  [502, { error: 'upstream' }, 'server'],
]) {
  test(`submit ${status} ${body.code ?? ''} -> ${kind}`, async () => {
    setFetch(reply(status, body));
    await assert.rejects(submit('x', 'seedance_2_5'), (e) => e instanceof EmakiError && e.kind === kind && e.message === body.error);
  });
}

test('status completed carries videoUrl', async () => {
  setFetch(reply(200, { success: true, data: { id: 'v1', status: 'completed', videoUrl: 'https://cdn.emaki.ai/x.png' } }));
  assert.equal((await getStatus('v1')).videoUrl, 'https://cdn.emaki.ai/x.png');
});

test('waitFor throws on failed with failureCode', async () => {
  setFetch(reply(200, { success: true, data: { id: 'v1', status: 'failed', failureCode: 'provider_error' } }));
  await assert.rejects(waitFor('v1', { intervalMs: 1 }), (e) => e.kind === 'failed' && e.code === 'provider_error');
});

test('waitFor polls until completed', async () => {
  let n = 0;
  setFetch(async () => new Response(JSON.stringify({ success: true, data: { id: 'v1', status: ++n < 3 ? 'generating' : 'completed', videoUrl: 'u' } }), { status: 200 }));
  assert.equal((await waitFor('v1', { intervalMs: 1 })).videoUrl, 'u');
  assert.equal(n, 3);
});

test('credits ok and code -1 refusal on HTTP 200', async () => {
  setFetch(reply(200, { code: 0, data: { remainingCredits: 42, hasPurchasedCredits: false } }));
  assert.equal((await credits()).remainingCredits, 42);
  setFetch(reply(200, { code: -1, message: 'no auth' }));
  await assert.rejects(credits(), (e) => e.kind === 'auth');
});
