import { NextRequest, NextResponse } from 'next/server';
import { Client } from 'pg';

export async function POST(req: NextRequest) {
  try {
    const { uri } = await req.json();
    if (!uri) return NextResponse.json({ error: 'Missing URI' }, { status: 400 });
    const client = new Client({ connectionString: uri });
    await client.connect();
    const tablesRes = await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`);
    const tables = tablesRes.rows.map((r: { table_name: string }) => r.table_name);
    const schema = [];
    for (const table of tables) {
      const colsRes = await client.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1`, [table]);
      const columns: { name: string; type: string }[] = colsRes.rows.map((c: { column_name: string; data_type: string }) => ({ name: c.column_name, type: c.data_type }));
      let sampleRows: unknown[] = [];
      try {
        const sampleRes = await client.query(`SELECT * FROM "${table}" LIMIT 5`);
        sampleRows = sampleRes.rows;
      } catch {}
      schema.push({ table, columns, sampleRows });
    }
    await client.end();
    return NextResponse.json(schema);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
} 