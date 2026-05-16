// Inspects all keys in Upstash Redis to see what data exists
// Run with: railway run node scripts/redis-inspect.js

const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN
});

(async () => {
  console.log('\n🔍 Upstash Redis — All Keys\n' + '='.repeat(50));

  const allKeys = await redis.keys('*');
  console.log(`\nTotal keys: ${allKeys.length}\n`);

  if (allKeys.length === 0) {
    console.log('(empty)');
    process.exit(0);
  }

  // Group by prefix
  const groups = {};
  for (const key of allKeys) {
    const prefix = key.split(':')[0];
    if (!groups[prefix]) groups[prefix] = [];
    groups[prefix].push(key);
  }

  for (const [prefix, keys] of Object.entries(groups)) {
    console.log(`${prefix}:* (${keys.length} keys)`);
    for (const key of keys.slice(0, 10)) {
      const ttl = await redis.ttl(key);
      const val = await redis.get(key);
      const valStr = typeof val === 'string' ? val.slice(0, 100) : JSON.stringify(val).slice(0, 100);
      console.log(`  ${key}  (ttl: ${ttl}s)  → ${valStr}`);
    }
    if (keys.length > 10) console.log(`  ... and ${keys.length - 10} more`);
    console.log();
  }

  process.exit(0);
})().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
