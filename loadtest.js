// Load test: simulate N concurrent users hitting the site
// Run: node loadtest.js [target_url] [concurrent_users]
// Example: node loadtest.js https://framegrab-production.up.railway.app 50

const BASE = process.argv[2] || 'http://localhost:3000';
const N = parseInt(process.argv[3] || '20', 10);

async function timeRequest(url, opts = {}) {
  const start = Date.now();
  try {
    const res = await fetch(url, opts);
    const text = await res.text();
    return { ok: res.ok, status: res.status, ms: Date.now() - start, body: text.slice(0, 200) };
  } catch (err) {
    return { ok: false, status: 0, ms: Date.now() - start, error: err.message };
  }
}

async function simulateUser(i) {
  const results = {};

  // 1. Load homepage
  results.home = await timeRequest(`${BASE}/`);

  // 2. Get config
  results.config = await timeRequest(`${BASE}/api/config`);

  // 3. Get queue status
  results.queue = await timeRequest(`${BASE}/api/queue-status`);

  // 4. Attempt checkout (will fail without real Stripe but tests the endpoint)
  results.checkout = await timeRequest(`${BASE}/api/checkout`, { method: 'POST' });

  return { user: i, results };
}

async function main() {
  console.log(`\n🔥 Load test: ${N} concurrent users → ${BASE}\n`);
  const start = Date.now();

  const promises = [];
  for (let i = 0; i < N; i++) promises.push(simulateUser(i));
  const all = await Promise.all(promises);

  const totalMs = Date.now() - start;

  // Aggregate
  const stats = {};
  for (const { results } of all) {
    for (const [endpoint, r] of Object.entries(results)) {
      if (!stats[endpoint]) stats[endpoint] = { ok: 0, fail: 0, times: [] };
      if (r.ok) stats[endpoint].ok++;
      else stats[endpoint].fail++;
      stats[endpoint].times.push(r.ms);
    }
  }

  console.log(`\n📊 Results (${totalMs}ms total)\n`);
  for (const [endpoint, s] of Object.entries(stats)) {
    const sorted = s.times.sort((a, b) => a - b);
    const avg = Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length);
    const p50 = sorted[Math.floor(sorted.length * 0.5)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const p99 = sorted[Math.floor(sorted.length * 0.99)];
    const max = sorted[sorted.length - 1];
    console.log(`${endpoint.padEnd(10)} | ✅ ${s.ok} / ❌ ${s.fail} | avg ${avg}ms | p50 ${p50}ms | p95 ${p95}ms | p99 ${p99}ms | max ${max}ms`);
  }

  // Show any failures
  const failures = all.flatMap(({ user, results }) =>
    Object.entries(results)
      .filter(([_, r]) => !r.ok)
      .map(([ep, r]) => ({ user, ep, status: r.status, error: r.error, body: r.body }))
  );

  if (failures.length > 0) {
    console.log(`\n⚠ Failures (${failures.length}):`);
    failures.slice(0, 10).forEach(f => console.log(`  user ${f.user} ${f.ep}: ${f.status} ${f.error || f.body}`));
  } else {
    console.log('\n✅ No failures');
  }
}

main().catch(err => { console.error(err); process.exit(1); });
