import { NextRequest, NextResponse } from 'next/server';
import { checkSystemRateLimit } from '../rateLimit';

export async function POST(req: NextRequest) {
  try {
    await checkSystemRateLimit();
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 429 });
  }
  const { messages } = await req.json();
  const apiKey = process.env.OPENAI_KEY;
  if (!apiKey) return NextResponse.json({ error: 'Missing OpenAI key' }, { status: 500 });

  const prompt = `Given the following chat history between a user and an assistant about a database, generate a concise, descriptive title (max 8 words) for this chat. Only output the title as plain text, no explanations or formatting.`;

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
          { role: 'system', content: 'You are a helpful assistant that summarizes database conversations.' },
          { role: 'user', content: prompt },
          { role: 'user', content: JSON.stringify(messages) },
        ],
        max_tokens: 32,
        temperature: 0.5,
      }),
    });
    const data = await openaiRes.json();
    if (!openaiRes.ok) throw new Error(data.error?.message || 'OpenAI error');
    const title = (data.choices?.[0]?.message?.content || '').replace(/\n/g, '').trim();
    return NextResponse.json({ title });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
} 