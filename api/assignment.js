// Vercel Serverless Function - Tziun Assignment Grader (digital text)
// Grades long typed assignments: score, per-question feedback, AI-writing signals
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  try {
    const { assignmentText, rubric, taskTitle, studentName, subject, grade, teacherGender, school_id, student_id } = req.body;
    if (!assignmentText || !studentName) {
      return res.status(400).json({ error: 'Missing assignment text or student name' });
    }

    const teacherTitle = teacherGender === 'female' ? 'בלשון נקבה' : 'בלשון זכר';

    const systemPrompt = `אתה "עפרון", בודק עבודות ומטלות מקצועי לבתי ספr בישראל. אתה בודק עבודה דיגיטלית (טקסט מוקלד) של תלמיד.

מקצוע: ${subject || 'כללי'}
כיתה: ${grade || ''}
שם התלמיד: ${studentName}
${taskTitle ? `שם המטלה: ${taskTitle}` : ''}

${rubric ? `**מחוון הבדיקה של המורה (בדוק לפיו):**\n${rubric}\n` : '**אין מחוון - בדוק לפי הסטנדרטים המקצועיים של המקצוע והכיתה.**'}

**משימתך - בדיקה מקיפה:**

1. **ציון (0-100)** - לפי איכות, עומק, דיוק, עמידה בדרישות.

2. **בדיקה מפורטת לפי חלקים** - לכל שאלה/חלק/פרק בעבודה: מה הוגש, מה טוב, מה חסר או שגוי, וכמה נקודות.

3. **רשימת שגיאות ברורה** - בדיוק איפה התלמיד טעה ובמה.

4. **זיהוי סימני כתיבת AI** - חשוב מאוד, אבל בזהירות:
   - חפש סימנים אופייניים: ניסוח אחיד ומלוטש מדי, היעדר טעויות אנושיות, מבנה גנרי, חזרתיות, ביטויים אופייניים ל-AI, חוסר קול אישי, דוגמאות כלליות מדי.
   - דווח כ-**רמת חשד** (נמוכה / בינונית / גבוהה), ולא כאחוז מדויק.
   - **אסור לקבוע בוודאות** שהעבודה נכתבה ב-AI. תמיד נסח כ"סימנים המעוררים חשד" והסבר *אילו* סימנים מצאת, כדי שהמורה תפעיל שיקול דעת.
   - אם אין סימנים - ציין זאת בבירור (רמה: נמוכה).

5. ${teacherTitle}, נסח את כל המשוב בהתאם.

**פורמט JSON בלבד, ללא markdown:**
{
  "score": 82,
  "max_score": 100,
  "bottom_line": "סיכום קצר של 2-3 משפטים",
  "strengths": ["נקודת חוזק ספציפית"],
  "weaknesses": ["איפה בדיוק נחלש / טעה"],
  "sections": [
    { "title": "חלק א - מבוא", "feedback": "מה טוב/חסר", "points": 18, "max": 20 }
  ],
  "ai_detection": {
    "suspicion_level": "low",
    "signals": ["סימן ספציפי שנמצא, אם יש"],
    "note": "הסבר קצר וזהיר למורה - לשיקול דעתה בלבד"
  },
  "confidence": "high"
}
(suspicion_level: "low" / "medium" / "high")`;

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
          content: `בדוק את העבודה הבאה של ${studentName}:\n\n---\n${assignmentText}\n---\n\nהחזר JSON בלבד.`
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

    if (result.max_score && result.max_score !== 100) {
      const ratio = 100 / result.max_score;
      result.score = Math.round(result.score * ratio);
      result.max_score = 100;
    }

    // Log AI usage
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
    console.error('Assignment grading error:', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}

export const config = {
  api: { bodyParser: { sizeLimit: '4mb' } }
};
