// Base62 = digits 0-9, a-z, A-Z  -> 62 symbols, all URL-safe.
// We turn the numeric database id into a short string, exactly like converting
// a number to base 2 or base 16, just with 62 "digits".
//
//   6 chars -> 62^6 ≈ 56.8 billion codes
//   7 chars -> 62^7 ≈ 3.5 trillion codes
const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const BASE = BigInt(ALPHABET.length); // 62n

// BigInt so ids beyond Number.MAX_SAFE_INTEGER still work (Postgres BIGSERIAL is 64-bit).
function encode(num) {
  let n = BigInt(num);
  if (n < 0n) throw new Error('Cannot encode negative numbers');
  if (n === 0n) return ALPHABET[0];

  let out = '';
  while (n > 0n) {
    out = ALPHABET[Number(n % BASE)] + out; // take the remainder as the next digit
    n = n / BASE;                           // integer division (BigInt truncates)
  }
  return out;
}

function decode(str) {
  let n = 0n;
  for (const ch of str) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error(`Invalid Base62 character: ${ch}`);
    n = n * BASE + BigInt(idx);
  }
  return n;
}

const isValidCode = (str) => /^[0-9a-zA-Z]{1,16}$/.test(str);

module.exports = { encode, decode, isValidCode, ALPHABET };
