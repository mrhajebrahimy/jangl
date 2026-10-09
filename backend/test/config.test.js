import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
test('refuses to start without a strong JWT_SECRET', () => {
  assert.throws(() => loadConfig({}));
  assert.throws(() => loadConfig({ JWT_SECRET: 'short' }));
  assert.throws(() => loadConfig({ JWT_SECRET: 'CHANGE_ME_' + 'x'.repeat(40) }));
  assert.equal(loadConfig({ JWT_SECRET: 'k'.repeat(40) }).accessTtl, 900);
});
