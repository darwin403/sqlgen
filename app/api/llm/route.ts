import { NextRequest, NextResponse } from 'next/server';
import { checkSystemRateLimit } from './rateLimit';

const RATE_LIMIT = 100;
const WINDOW_SECONDS = 24 * 60 * 60; // 24 hours
const KV_KEY = 'llm_request_count_daily';

export async function POST(req: NextRequest) {
  try {
    await checkSystemRateLimit();
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 429 });
  }

  const body = await req.json();
  const { messages, prompt, schema } = body;
  const apiKey = process.env.OPENAI_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'Missing OpenAI key' }, { status: 500 });
  }

  // Build schema description with quotes for table names with dots
  const schemaDesc = schema
    .map((t: { table: string; columns: { name: string; type: string }[]; sampleRows?: unknown[] }) => {
      const tableName = t.table.includes('.') ? `public."${t.table}"` : t.table;
      const cols = t.columns.map((c: { name: string; type: string }) => `${c.name} ${c.type}`).join(', ');
      let sampleRowsStr = '';
      if (t.sampleRows && t.sampleRows.length > 0) {
        sampleRowsStr = `\nSample rows: ${JSON.stringify(t.sampleRows)}`;
      }
      return `${tableName}(${cols})${sampleRowsStr}`;
    })
    .join('; ');

  const system = `You are a helpful assistant that writes SQL for Postgres. Given a database schema and a user request, write a single SQL query that answers the request. \n- If a table name contains a period ('.'), always reference it as public.\"table.name\" (with double quotes and public schema), not as schema.table.\n- Always use double quotes for such table names in SQL.\nOnly output the SQL, nothing else.`;

  let chatMessages;
  if (Array.isArray(messages) && messages.length > 0) {
    // Ensure last user message is present
    const lastUser = messages.slice().reverse().find(m => m.role === 'user');
    if (!lastUser || !lastUser.content?.trim()) {
      return NextResponse.json({ error: 'No SQL query can be generated because the user request is undefined.' }, { status: 400 });
    }
    chatMessages = [
      { role: 'system', content: `${system}\nSchema: ${schemaDesc}` },
      ...messages,
    ];
  } else if (prompt) {
    chatMessages = [
      { role: 'system', content: `${system}\nSchema: ${schemaDesc}` },
      { role: 'user', content: prompt },
    ];
  } else {
    return NextResponse.json({ error: 'No SQL query can be generated because the user request is undefined.' }, { status: 400 });
  }

  try {
    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4.1',
        messages: chatMessages,
        max_tokens: 256,
        temperature: 0,
      }),
    });
    const data = await openaiRes.json();
    if (!openaiRes.ok) throw new Error(data.error?.message || 'OpenAI error');
    let sql = data.choices?.[0]?.message?.content?.trim() || '';
    // Remove markdown code block enclosures
    sql = sql.replace(/^```sql\s*|^```|```$/gim, '').replace(/```$/g, '').trim();
    return NextResponse.json({ sql });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
} 