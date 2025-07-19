import { NextRequest, NextResponse } from 'next/server';
import { createClient } from 'redis';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const password = searchParams.get('password');
  if (!password || password !== process.env.RESET_PASSWORD) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const redis = createClient({ url: process.env.REDIS_URL });
  await redis.connect();
  await redis.del('llm_request_count_daily');
  await redis.quit();
  return NextResponse.json({ success: true });
} 