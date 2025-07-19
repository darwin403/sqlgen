import { NextRequest, NextResponse } from 'next/server';
import { Client } from 'pg';

export async function POST(req: NextRequest) {
  try {
    const { uri, sql } = await req.json();
    if (!uri || !sql) return NextResponse.json({ error: 'Missing uri or sql' }, { status: 400 });
    const client = new Client({ connectionString: uri });
    await client.connect();
    const res = await client.query(sql);
    await client.end();
    return NextResponse.json({ columns: res.fields.map((f: any) => f.name), rows: res.rows });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
} 