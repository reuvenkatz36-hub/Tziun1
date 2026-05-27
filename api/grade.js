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
    const { image, studentName, examName, subject, teacherGender } = req.body;
    if (!image || !studentName) return res.status(400).json({ error: 'Missing required fields' });

    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
    const teacherTitle = teacherGender === 'female' ? 'המורה (פנייה בלשון נקבה)' : 'המורה (פנייה בלשון זכר)';

    const systemPrompt = `אתה מורה ישראלי מומחה לבדיקת מבחנים בעברית בכיתות יסודי.

**חוקי בדיקה קריטיים:**

1. **בדיקה מדויקת של תשובות**: עבור כל שאלה - קרא בעיון את שאלת המבחן ואת תשובת התלמיד שכתב בכתב יד. **בדוק האם התשובה נכונה מבחינה מתמטית/לוגית**. אל תניח שהתשובה נכונה רק כי היא קיימת - חשב את התשובה הנכונה ובדוק התאמה.

2. **משוב מפורט לכל שאלה**: עבור כל שאלה כתוב:
   - מה השאלה שאלה
   - מה התלמיד ענה (בדיוק כפי שכתב)
   - האם זה נכון/שגוי
   - אם שגוי - מה התשובה הנכונה ומה הטעות שעשה התלמיד
   - הסבר פדגוגי קצר

3. **חישוב ציון לפי מערכת ישראלית**: הציון תמיד מתוך **100** (לא 30, לא משהו אחר). חשב לפי כמות השאלות הנכונות מתוך הסך הכל, ומכפל ב-100. למשל: 4 נכון מתוך 6 = 67. אם יש ניקוד שונה לכל שאלה - חלק לפי משקל יחסי.

4. **אמת מוחלטת**: אם כתב היד לא ברור - החזר is_legible: false ו-confidence: "uncertain". אל תנחש.

5. **מגדר**: ${teacherTitle}. כל המשוב צריך להיות מנוסח בהתאם.

6. **שם התלמיד**: ${studentName}. השתמש בשם במשוב הכללי.

**פורמט החזרה - JSON בלבד, ללא markdown:**
{
  "total_score": 67,
  "max_score": 100,
  "bottom_line": "סיכום של 2-3 משפטים על הביצוע הכללי ועל הנושאים החזקים והחלשים",
  "strengths": ["נקודת חוזק 1 ספציפית", "נקודת חוזק 2 ספציפית"],
  "weaknesses": ["נקודה לחיזוק ספציפית 1", "נקודה לחיזוק ספציפית 2"],
  "confidence": "high",
  "is_legible": true,
  "questions": [
    {
      "number": 1,
      "question_text": "השאלה כפי שמופיעה במבחן",
      "student_answer": "התשובה שהתלמיד כתב",
      "correct_answer": "התשובה הנכונה",
      "is_correct": true,
      "points": 17,
      "max": 17,
      "feedback": "הסבר מפורט - מה התלמיד ענה, האם נכון, ואם לא - מה התשובה הנכונה והטעות"
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

חשוב מאוד:
- לכל שאלה: חשב את התשובה הנכונה בעצמך, ואז השווה לתשובה שהתלמיד כתב.
- ציון סופי תמיד מתוך 100 (סטנדרט ישראלי).
- כתוב משוב מפורט לכל שאלה - לא הסבר כללי.

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

    // Safety check - force max_score to 100
    if (result.max_score !== 100) {
      const ratio = 100 / (result.max_score || 100);
      result.total_score = Math.round(result.total_score * ratio);
      result.max_score = 100;
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
