import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  const { prompt, schema } = await req.json();
  const apiKey = process.env.OPENAI_KEY;
  if (!apiKey) return NextResponse.json({ error: 'Missing OpenAI key' }, { status: 500 });

  // Build schema description with quotes for table names with dots
  const schemaDesc = schema
    .map((t: any) => {
      const tableName = t.table.includes('.') ? `public."${t.table}"` : t.table;
      return `${tableName}(${t.columns.join(', ')})`;
    })
    .join('; ');

  const system = `You are a helpful assistant that writes SQL for Postgres. Given a database schema and a user request, write a single SQL query that answers the request. 
- If a table name contains a period ('.'), always reference it as public."table.name" (with double quotes and public schema), not as schema.table.
- Always use double quotes for such table names in SQL.
Only output the SQL, nothing else.`;
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
    return NextResponse.json({ sql });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
} 