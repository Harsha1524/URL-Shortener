// Run with: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { encode, decode, isValidCode } = require('../src/lib/base62');

test('encodes known values', () => {
  assert.equal(encode(0), '0');
  assert.equal(encode(61), 'Z');
  assert.equal(encode(62), '10');
  assert.equal(encode(100001), 'q0V'); // id 1 + offset 100000 = the first short code
});

test('decode reverses encode, including numbers beyond JS safe integers', () => {
  for (const n of [1n, 61n, 62n, 3844n, 100001n, 9007199254740993n]) {
    assert.equal(decode(encode(n)), n);
  }
});

test('rejects bad input', () => {
  assert.throws(() => encode(-1));
  assert.throws(() => decode('not valid!'));
});

test('isValidCode accepts only Base62 characters', () => {
  assert.equal(isValidCode('q0V'), true);
  assert.equal(isValidCode('favicon.ico'), false);
  assert.equal(isValidCode(''), false);
  assert.equal(isValidCode('a'.repeat(17)), false);
});
