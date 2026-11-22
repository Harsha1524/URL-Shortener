// Hits one short code many times and shows how the cache absorbs the load.
//   npm run loadtest -- <shortCode> [requests]
// Tip: raise RATE_LIMIT_REDIRECT_MAX in .env first, or you'll see 429s (which is also a lesson!).
const BASE = process.env.BASE_URL || 'http://localhost:3000';
const code = process.argv[2];
const total = parseInt(process.argv[3] || '50', 10);

if (!code) {
  console.error('Usage: npm run loadtest -- <shortCode> [requests]');
  process.exit(1);
}

(async () => {
  const before = await (await fetch(`${BASE}/api/metrics`)).json();
  const statuses = {};
  const cache = { HIT: 0, MISS: 0 };
  const t0 = Date.now();

  for (let i = 0; i < total; i++) {
    const res = await fetch(`${BASE}/${code}`, { redirect: 'manual' });
    statuses[res.status] = (statuses[res.status] || 0) + 1;
    const x = res.headers.get('x-cache');
    if (x) cache[x]++;
  }

  const ms = Date.now() - t0;
  const after = await (await fetch(`${BASE}/api/metrics`)).json();

  console.log(`\n${total} requests in ${ms}ms (${(ms / total).toFixed(2)} ms/req)`);
  console.log('Status codes:', statuses);
  console.log('X-Cache:', cache);
  console.log('DB queries made by server during test:', after.dbQueriesThisProcess - before.dbQueriesThisProcess);
  console.log('Click queue now:', after.clickQueue);
})();
