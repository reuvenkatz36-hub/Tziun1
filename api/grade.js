// Vercel Serverless Function - Claude AI Exam Grading
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  try {
    const { image, studentName, examName, subject, teacherGender, school_id, student_id } = req.body;
    if (!image || !studentName) return res.status(400).json({ error: 'Missing required fields' });

    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
    const teacherTitle = teacherGender === 'female' ? 'המורה (פנייה בלשון נקבה)' : 'המורה (פנייה בלשון זכר)';

    const systemPrompt = `אתה מורה ישראלי מומחה לבדיקת מבחנים בעברית בכיתות יסודי.

**חוקי בדיקה קריטיים:**

1. **בדיקה מדויקת**: עבור כל שאלה - קרא את שאלת המבחן ואת תשובת התלמיד. חשב את התשובה הנכונה בעצמך, ואז השווה. אל תניח שהתשובה נכונה רק כי היא קיימת.

2. **משוב מפורט לכל שאלה**: כתוב מה השאלה, מה התלמיד ענה, האם נכון, ואם שגוי - מה התשובה הנכונה ומה הטעות.

3. **ציון מתוך 100 (סטנדרט ישראלי)**. תמיד.

4. **אמת מוחלטת**: אם כתב היד לא ברור - is_legible: false, confidence: "uncertain". אל תנחש.

5. **מגדר**: ${teacherTitle}. נסח בהתאם.

6. **שם התלמיד**: ${studentName}.

**פורמט JSON בלבד, ללא markdown:**
{
  "total_score": 67,
  "max_score": 100,
  "bottom_line": "סיכום של 2-3 משפטים",
  "strengths": ["נקודה ספציפית"],
  "weaknesses": ["נקודה ספציפית"],
  "confidence": "high",
  "is_legible": true,
  "questions": [
    {
      "number": 1,
      "question_text": "השאלה",
      "student_answer": "תשובת התלמיד",
      "correct_answer": "התשובה הנכונה",
      "is_correct": true,
      "points": 17,
      "max": 17,
      "feedback": "הסבר מפורט"
    }
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
        max_tokens: 4096,
        system: systemPrompt,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64Data } },
            { type: 'text', text: `בדוק את המבחן "${examName || 'מבחן'}" של ${studentName} ב${subject || 'מקצוע'}.

חשוב:
- לכל שאלה: חשב את התשובה הנכונה בעצמך, ואז השווה.
- ציון מתוך 100.
- משוב מפורט לכל שאלה.

החזר JSON בלבד.` }
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

    if (result.max_score !== 100) {
      const ratio = 100 / (result.max_score || 100);
      result.total_score = Math.round(result.total_score * ratio);
      result.max_score = 100;
    }

    // Log AI usage (fire and forget)
    if (school_id) {
      const SUPABASE_URL = process.env.SUPABASE_URL;
      const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
      if (SUPABASE_URL && SERVICE_KEY) {
        fetch(`${SUPABASE_URL}/rest/v1/ai_usage`, {
          method: 'POST',
          headers: {
            'apikey': SERVICE_KEY,
            'Authorization': `Bearer ${SERVICE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({ school_id, student_id })
        }).catch(e => console.error('Log AI failed', e));
      }
    }

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
