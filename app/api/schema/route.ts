import { NextRequest, NextResponse } from 'next/server';
import { Client } from 'pg';

export async function POST(req: NextRequest) {
  try {
    const { uri } = await req.json();
    if (!uri) return NextResponse.json({ error: 'Missing URI' }, { status: 400 });
    const client = new Client({ connectionString: uri });
    await client.connect();
    const tablesRes = await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`);
    const tables = tablesRes.rows.map((r: any) => r.table_name);
    const schema = [];
    for (const table of tables) {
      const colsRes = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_name = $1`, [table]);
      schema.push({ table, columns: colsRes.rows.map((c: any) => c.column_name) });
    }
    await client.end();
    return NextResponse.json(schema);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
} 