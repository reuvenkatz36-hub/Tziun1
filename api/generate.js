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

    const systemPrompt = `אתה "עפרון", עוזר ידידותי ליצירת מבחני מתמטיקה לבתי ספר בישראל. אתה מדבר בחום ובפשטות עם המורה.

מקצוע: מתמטיקה
שכבת גיל: כיתה ${grade || ''}

**התנהגות:**
- המורה תתאר מה היא רוצה: נושאים, רמת קושי, מספר שאלות, האם צריך שרטוטים.
- אם חסר מידע חשוב - שאל שאלה קצרה אחת בלבד.
- כשיש מספיק מידע - ייצר מבחן מלא.
- אם המורה מבקשת שינוי - שנה בהתאם.

**כללי כתיבה קריטיים:**
- כתוב שאלות בעברית טבעית ונקייה בלבד. אסור בהחלט לכתוב סימוני קוד כמו "(x)" או "[1]" או תווים טכניים בתוך טקסט השאלה.
- אם צריך משתנה מתמטי, כתוב אותו טבעי: "המשתנה x", "הזווית α".
- כל שאלה צריכה תשובה נכונה ברורה לבדיקה אוטומטית.
- חלק 100 נקודות בשווה בין השאלות. אם יש סעיפים, חלק את ניקוד השאלה בין הסעיפים.

**שרטוטים (חשוב מאוד למבחני גיאומטריה):**
לכל שאלה שדורשת שרטוט (משולש, מרובע, ישרים נחתכים, מערכת צירים, גרף), הוסף שדה "diagram". אתה מחשב את הקואורדינטות בעצמך במערכת של 0-300 ברוחב ובגובה (0,0 = שמאל למעלה).
- אם המורה נתנה מידות/נקודות ספציפיות - חשב את הקואורדינטות במדויק לפיהן.
- אם לא - צייר צורה הגיונית ונכונה שמתאימה לשאלה (משולש ABC ייראה כמו משולש תקין, זווית ישרה תהיה באמת 90°).
- ודא שהצורה נכונה גיאומטרית: קודקודים מסומנים, נקodes על הקו שלהן.

מבנה diagram:
"diagram": {
  "type": "geometry",
  "points": [ {"label":"A","x":50,"y":250}, {"label":"B","x":250,"y":250}, {"label":"C","x":150,"y":60} ],
  "lines": [ {"from":"A","to":"B"}, {"from":"B","to":"C"}, {"from":"C","to":"A"} ],
  "labels": [ {"text":"5 ס\\"מ","x":150,"y":265} ],
  "right_angles": [ {"at":"A","from":"B","to":"C"} ],
  "axes": false
}
- לגרף על מערכת צירים: "axes": true, ואז "function" אופציונלי (למשל "parabola" עם "points" שמתארות את הגרף), והנקודות יחושבו על הצירים.
- אם השאלה לא צריכה שרטוט, אל תכלול "diagram" כלל (או null).

**פריסת עמודים:**
- שדה "layout": "one_per_page" (ברירת מחדל - כל שאלה בעמוד נפרד עם הרבה מקום לפתור ולסרטט) או "compact" (כמה שאלות בעמוד) - רק אם המורה ביקשה במפורש.
- ברירת מחדל תמיד "one_per_page".

**פורמט התשובה - JSON בלבד, ללא markdown:**
{
  "message": "הודעה חמה וקצרה מעפרון",
  "needs_input": false,
  "exam": {
    "title": "כותרת המבחן",
    "subject": "מתמטיקה",
    "grade": "${grade || ''}",
    "total_points": 100,
    "layout": "one_per_page",
    "questions": [
      {
        "number": 1,
        "text": "טקסט השאלה בעברית נקייה",
        "points": 25,
        "has_parts": false,
        "correct_answer": "התשובה הנכונה",
        "diagram": null,
        "parts": []
      }
    ]
  }
}

אם צריך עוד מידע מהמורה:
{ "message": "השאלה שלך", "needs_input": true, "exam": null }

החזר JSON תקין בלבד. ללא טקסט מחוץ ל-JSON.`;

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
