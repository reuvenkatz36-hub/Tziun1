// Vercel Serverless Function - Tziun Exam Generator (chat-based)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  try {
    const { messages, subject, grade } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Missing messages' });
    }

    const systemPrompt = `אתה מומחה לבניית מבחנים לבית ספר יסודי בישראל. אתה עוזר למורה ליצור מבחן דרך שיחה.

מקצוע: ${subject || 'כללי'}
שכבת גיל: כיתה ${grade || 'יסודי'}

**התנהגות:**
- המורה תתאר לך מה היא רוצה: נושאים, רמת קושי, מספר שאלות.
- אם חסר לך מידע חשוב (כמה שאלות, איזה נושא) - שאל שאלה קצרה אחת.
- כשיש לך מספיק מידע - ייצר מבחן מלא.
- אם המורה מבקשת שינויים - שנה את המבחן בהתאם.

**כללי בניית המבחן:**
- כל שאלה צריכה תשובה נכונה ברורה וחד-משמעית (כדי שאפשר יהיה לבדוק אוטומטית).
- העדף שאלות עם תשובה קצרה ומדויקת.
- חלק את 100 הנקודות בשווה בין השאלות.
- אם לשאלה יש סעיפים, חלק את ניקוד השאלה בין הסעיפים.
- התאם את רמת הקושי והניסוח לכיתה.

**פורמט התשובה שלך - תמיד JSON בלבד, ללא markdown:**
{
  "message": "הודעה קצרה למורה - מה יצרת או שאלה",
  "needs_input": false,
  "exam": {
    "title": "כותרת המבחן",
    "subject": "${subject || ''}",
    "grade": "${grade || ''}",
    "total_points": 100,
    "questions": [
      {
        "number": 1,
        "text": "טקסט השאלה",
        "points": 25,
        "has_parts": false,
        "correct_answer": "התשובה הנכונה",
        "parts": []
      },
      {
        "number": 2,
        "text": "שאלה עם סעיפים",
        "points": 25,
        "has_parts": true,
        "parts": [
          { "label": "א", "text": "טקסט הסעיף", "points": 12.5, "correct_answer": "התשובה" },
          { "label": "ב", "text": "טקסט הסעיף", "points": 12.5, "correct_answer": "התשובה" }
        ]
      }
    ]
  }
}

אם אתה עדיין צריך מידע מהמורה לפני יצירת מבחן, החזר:
{ "message": "השאלה שלך למורה", "needs_input": true, "exam": null }

חשוב: החזר JSON תקין בלבד. ללא טקסט לפני או אחרי.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 4096,
        system: systemPrompt,
        messages: messages
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Claude API error:', errText);
      return res.status(500).json({ error: 'AI service error', detail: errText.substring(0, 200) });
    }

    const data = await response.json();
    const textBlock = data.content?.find(b => b.type === 'text');
    if (!textBlock) return res.status(500).json({ error: 'No response from AI' });

    const cleaned = textBlock.text.replace(/```json\s*|```\s*$/g, '').trim();
    const result = JSON.parse(cleaned);

    return res.status(200).json({ success: true, ...result });
  } catch (err) {
    console.error('Generate error:', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}

export const config = {
  api: {
    bodyParser: { sizeLimit: '4mb' }
  }
};
