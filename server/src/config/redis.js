import { createClient } from 'redis';

const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
});

redisClient.on('error', (err) => {
  console.error('Redis Client Error:', err);
});

redisClient.on('connect', () => {
  console.log('✅ Connected to Redis');
});

// Fire-and-forget connect — don't block module import.
// The redis client auto-reconnects; call sites already handle disconnected state.
redisClient.connect().catch((err) => {
  console.error('Redis initial connect failed (will retry in background):', err.message);
});

export default redisClient;
