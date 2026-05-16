// Pulls free-trial usage stats from Upstash Redis
// Run with: railway run node scripts/free-stats.js
//
// Outputs:
//  - Unique IPs that ran ≥1 free trial in last 24h
//  - Distribution (1 vs 2 vs 3 trials)
//  - Total free jobs run

const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN
});

(async () => {
  console.log('\n📊 FrameGrab Free Trial Analytics\n' + '='.repeat(50));

  // Get all free:* keys (current and previous day still in TTL)
  const keys = await redis.keys('free:*');

  if (!keys || keys.length === 0) {
    console.log('\nNo free trial data found in Redis (TTL is 24h).');
    process.exit(0);
  }

  // Group by IP (a single IP can have keys for today AND yesterday if active across midnight)
  const ipUsage = {};
  for (const key of keys) {
    // Format: free:{ip}:{YYYY-MM-DD}
    const parts = key.split(':');
    if (parts.length < 3) continue;
    const date = parts[parts.length - 1];
    const ip = parts.slice(1, -1).join(':'); // handle IPv6 addresses
    const count = parseInt(await redis.get(key), 10) || 0;

    if (!ipUsage[ip]) ipUsage[ip] = { total: 0, byDate: {} };
    ipUsage[ip].byDate[date] = count;
    ipUsage[ip].total += count;
  }

  const uniqueIps = Object.keys(ipUsage);
  const totalJobs = uniqueIps.reduce((sum, ip) => sum + ipUsage[ip].total, 0);

  // Distribution buckets
  const distribution = { '1': 0, '2': 0, '3': 0, '3+': 0 };
  for (const ip of uniqueIps) {
    const total = ipUsage[ip].total;
    if (total === 1) distribution['1']++;
    else if (total === 2) distribution['2']++;
    else if (total === 3) distribution['3']++;
    else if (total > 3) distribution['3+']++;
  }

  console.log(`\nUnique IPs with ≥1 free trial: ${uniqueIps.length}`);
  console.log(`Total free jobs run: ${totalJobs}`);
  console.log(`\nDistribution (trials per IP):`);
  console.log(`  1 trial:  ${distribution['1']} IPs (${pct(distribution['1'], uniqueIps.length)})`);
  console.log(`  2 trials: ${distribution['2']} IPs (${pct(distribution['2'], uniqueIps.length)})`);
  console.log(`  3 trials: ${distribution['3']} IPs (${pct(distribution['3'], uniqueIps.length)})`);
  if (distribution['3+'] > 0) {
    console.log(`  >3:       ${distribution['3+']} IPs (anomaly — limit should cap at 3)`);
  }

  // List IPs that hit the cap (potential power users)
  const cappedIps = uniqueIps.filter(ip => ipUsage[ip].total >= 3);
  if (cappedIps.length > 0) {
    console.log(`\n${cappedIps.length} IPs hit or exceeded the 3-trial cap — these are your strongest free-tier engagement signals.`);
  }

  // Note about correlation
  console.log(`\n⚠ Note: IP → Stripe payment correlation is not yet logged.`);
  console.log(`To enable that, we need to log client IPs against paid sessions.`);

  console.log('\n' + '='.repeat(50) + '\n');
  process.exit(0);
})().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});

function pct(n, total) {
  if (total === 0) return '0%';
  return Math.round((n / total) * 100) + '%';
}
