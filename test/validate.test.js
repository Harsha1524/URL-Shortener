const test = require('node:test');
const assert = require('node:assert/strict');
const { validateUrl } = require('../src/lib/validate');

test('accepts normal http/https URLs and normalises them', () => {
  assert.equal(validateUrl('https://example.com').url, 'https://example.com/');
  assert.equal(validateUrl('  http://iitm.ac.in/a?b=1  ').url, 'http://iitm.ac.in/a?b=1');
});

test('rejects unsafe or invalid URLs', () => {
  assert.ok(validateUrl('').error);
  assert.ok(validateUrl('hello').error);
  assert.ok(validateUrl('ftp://example.com').error);
  assert.ok(validateUrl('javascript:alert(1)').error);
  assert.ok(validateUrl('https://user:pass@example.com').error);
  assert.ok(validateUrl('https://example.com/' + 'a'.repeat(2100)).error);
  assert.ok(validateUrl(42).error);
});

test('rejects links to the shortener itself (redirect loops)', () => {
  assert.ok(validateUrl('https://sho.rt/abc', { ownHost: 'sho.rt' }).error);
  assert.equal(validateUrl('https://other.site/x', { ownHost: 'sho.rt' }).error, undefined);
});
