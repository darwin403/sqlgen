import { NextRequest, NextResponse } from 'next/server';
import { checkSystemRateLimit } from '../llm/rateLimit';

export async function POST(req: NextRequest) {
  try {
    await checkSystemRateLimit();
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 429 });
  }
  const { schema } = await req.json();
  const apiKey = process.env.OPENAI_KEY;
  if (!apiKey) return NextResponse.json({ error: 'Missing OpenAI key' }, { status: 500 });

  const schemaDesc = schema
    .map((t: { table: string; columns: { name: string; type: string }[] }) => {
      const tableName = t.table.includes('.') ? `public."${t.table}"` : t.table;
      const cols = t.columns.map((c: { name: string; type: string }) => `${c.name} ${c.type}`).join(', ');
      return `${tableName}(${cols})`;
    })
    .join('; ');

  const prompt = `Given the following Postgres database schema, generate 5 diverse, realistic, and interesting natural language questions a user might ask about this database. Only output the questions as a JSON array of strings, no explanations or SQL.
Schema: ${schemaDesc}`;

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
          { role: 'system', content: 'You are a helpful assistant that generates natural language questions for a database.' },
          { role: 'user', content: prompt },
        ],
        max_tokens: 256,
        temperature: 0.7,
      }),
    });
    const data = await openaiRes.json();
    if (!openaiRes.ok) throw new Error(data.error?.message || 'OpenAI error');
    let suggestions: string[] = [];
    try {
      suggestions = JSON.parse(data.choices?.[0]?.message?.content || '[]');
    } catch {
      suggestions = [];
    }
    return NextResponse.json({ suggestions });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
} 