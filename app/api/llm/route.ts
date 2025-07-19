import { NextRequest, NextResponse } from 'next/server';
import { createClient } from 'redis';

const RATE_LIMIT = 100;  
const WINDOW_SECONDS = 24 * 60 * 60; // 24 hours
const KV_KEY = 'llm_request_count_daily';

export async function POST(req: NextRequest) {
  // Connect to Redis
  const redis = createClient({ url: process.env.REDIS_URL });
  await redis.connect();

  // System-wide rate limit using Redis
  let count = await redis.incr(KV_KEY);
  if (count === 1) {
    await redis.expire(KV_KEY, WINDOW_SECONDS);
  }
  if (count > RATE_LIMIT) {
    await redis.quit();
    return NextResponse.json({ error: `System-wide rate limit exceeded. Usage: ${count}/${RATE_LIMIT}. Try again later.` }, { status: 429 });
  }

  const { prompt, schema } = await req.json();
  const apiKey = process.env.OPENAI_KEY;
  if (!apiKey) {
    await redis.quit();
    return NextResponse.json({ error: 'Missing OpenAI key' }, { status: 500 });
  }

  // Build schema description with quotes for table names with dots
  const schemaDesc = schema
    .map((t: any) => {
      const tableName = t.table.includes('.') ? `public."${t.table}"` : t.table;
      return `${tableName}(${t.columns.join(', ')})`;
    })
    .join('; ');

  const system = `You are a helpful assistant that writes SQL for Postgres. Given a database schema and a user request, write a single SQL query that answers the request. \n- If a table name contains a period ('.'), always reference it as public.\"table.name\" (with double quotes and public schema), not as schema.table.\n- Always use double quotes for such table names in SQL.\nOnly output the SQL, nothing else.`;
  const user = `Schema: ${schemaDesc}\nRequest: ${prompt}`;

  try {
    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4.1',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        max_tokens: 256,
        temperature: 0,
      }),
    });
    const data = await openaiRes.json();
    if (!openaiRes.ok) throw new Error(data.error?.message || 'OpenAI error');
    let sql = data.choices?.[0]?.message?.content?.trim() || '';
    // Remove markdown code block enclosures
    sql = sql.replace(/^```sql\s*|^```|```$/gim, '').replace(/```$/g, '').trim();
    await redis.quit();
    return NextResponse.json({ sql });
  } catch (e: any) {
    await redis.quit();
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
} 