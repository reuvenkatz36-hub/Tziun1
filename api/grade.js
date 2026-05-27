// Vercel Serverless Function - Claude AI Exam Grading
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured' });
  }

  try {
    const { image, studentName, examName, subject, teacherGender } = req.body;
    if (!image || !studentName) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Strip data URL prefix if present
    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');

    const teacherTitle = teacherGender === 'female' ? 'המורה (לשון נקבה)' : 'המורה (לשון זכר)';

    const systemPrompt = `אתה עוזר הוראה מומחה לבדיקת מבחנים בעברית בכיתות יסודי.

חוקים קריטיים:
1. **אמת מוחלטת**: אם כתב היד לא ברור או אתה לא בטוח - אל תנחש. החזר is_legible: false ו-confidence: "uncertain".
2. **מגדר**: ${teacherTitle}. כל המשוב צריך להיות מנוסח בהתאם למגדר זה.
3. **שם התלמיד**: ${studentName}.
4. **משוב בונה**: חיובי וקונקרטי.

החזר JSON תקין בלבד, ללא markdown ובלי טקסט נוסף:
{
  "total_score": 85,
  "max_score": 100,
  "bottom_line": "סיכום של 2 משפטים על הביצוע",
  "strengths": ["נקודת חוזק 1", "נקודת חוזק 2"],
  "weaknesses": ["נקודה לחיזוק 1"],
  "confidence": "high",
  "is_legible": true,
  "questions": [
    {"number": 1, "is_correct": true, "points": 10, "max": 10, "feedback": "תשובה מצוינת"},
    {"number": 2, "is_correct": false, "points": 4, "max": 10, "feedback": "שים לב לחישוב"}
  ]
}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64Data } },
            { type: 'text', text: `בדוק את המבחן "${examName || 'מבחן'}" של ${studentName} ב${subject || 'מקצוע'}. החזר JSON בלבד.` }
          ]
        }]
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

    return res.status(200).json({ success: true, result });
  } catch (err) {
    console.error('Grading error:', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}

export const config = {
  api: {
    bodyParser: { sizeLimit: '10mb' }
  }
};
