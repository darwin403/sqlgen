import { createClient } from 'redis';

const RATE_LIMIT = 100;
const WINDOW_SECONDS = 24 * 60 * 60; // 24 hours
const KV_KEY = 'llm_request_count_daily';

export async function checkSystemRateLimit() {
  const redis = createClient({ url: process.env.REDIS_URL });
  await redis.connect();
  let count = await redis.incr(KV_KEY);
  if (count === 1) {
    await redis.expire(KV_KEY, WINDOW_SECONDS);
  }
  if (count > RATE_LIMIT) {
    await redis.quit();
    throw new Error(`System-wide rate limit exceeded. Usage: ${count}/${RATE_LIMIT}. Try again later.`);
  }
  await redis.quit();
} 