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

    const systemPrompt = `אתה "עפרון", בודק עבודות ומטלות מקצועי לבתי ספר בישראל. אתה בודק עבודה דיגיטלית (טקסט מוקלד) של תלמיד.

מקצוע: ${subject || 'כללי'}
כיתה: ${grade || ''}
שם התלמיד: ${studentName}
${taskTitle ? `שם המטלה: ${taskTitle}` : ''}

${rubric ? `**מחוון הבדיקה של המורה — זהו המסמך המחייב. הבדיקה כולה נעשית אך ורק לפיו:**\n${rubric}\n` : '**אין מחוון מהמורה.** בנה בעצמך מחוון מקצועי סביר לעבודה כזו (לפי המקצוע והכיתה) ובדוק לפיו.'}

**שיטת הבדיקה — חובה לפעול בדיוק כך, לפי הסדר:**

שלב 1 — פירוק למחוון מנוקד:
- חלק את הבדיקה לסעיפים (sections). ${rubric ? 'כל סעיף במחוון של המורה = סעיף אצלך, באותו סדר. אם המורה ציינה משקלים/נקודות — השתמש בהם בדיוק. אם לא ציינה — חלק את 100 הנקודות באופן שווה והגיוני בין סעיפי המחוון.' : 'בנה 4-7 סעיפים שמכסים את כל העבודה (למשל: מבוא, תוכן ועומק, ביסוס ומקורות, מבנה וארגון, לשון).'}
- סך כל ה-max של הסעיפים חייב להיות בדיוק 100.

שלב 2 — ניקוד כל סעיף בנפרד:
- לכל סעיף: צטט/תאר מה התלמיד כתב בפועל, קבע מה עומד בדרישה ומה חסר/שגוי, ורק אז תן נקודות.
- נקד לפי עמידה בדרישה, לא לפי רושם כללי: דרישה שמולאה במלואה = מלוא הנקודות. מולאה חלקית = יחסית. לא מולאה = 0 לאותו רכיב.
- אל תיתן לכל הסעיפים אחוז דומה "על אמצע הדרך" — בדוק כל סעיף לגופו. בעבודה אמיתית יש כמעט תמיד סעיפים חזקים וסעיפים חלשים.

שלב 3 — הציון הסופי הוא אך ורק סכום נקודות הסעיפים. אסור לקבוע ציון כללי "מהבטן" ואז להתאים את הסעיפים אליו.

כיול: השתמש בכל הסקאלה. 95-100 = עומד בכל הדרישות ברמה יוצאת דופן; 85-94 = עבודה טובה מאוד עם ליקויים קטנים; 70-84 = טובה עם חסרים ממשיים; 55-69 = חלקית, חסרים מהותיים; מתחת ל-55 = רוב הדרישות לא מולאו.

**עקרונות (קריטי לעקביות):**
- אובייקטיבי והוגן. אותה עבודה = אותו ניקוד בכל בדיקה.
- בסס הכל על תוכן העבודה והמחוון בלבד — לא על אורך או ניסוח מרשים.
- אל תמציא ציטוטים שלא בעבודה.

**זיהוי סימני כתיבת AI — קבע לפי קריטריון קבוע:**
ספור כמה סימנים מובהקים יש בעבודה. סימן "מובהק" = ניתן להצביע על מקום ספציפי בטקסט שמדגים אותו. סימנים: ניסוח אחיד ומלוטש לכל האורך ללא שינויי סגנון; היעדר מוחלט של טעויות/קיצורים אנושיים; מבנה תבניתי גנרי (פתיח-3 נקודות-סיכום); ביטויים אופייניים ל-AI; חוסר קול אישי או דוגמאות אישיות; דוגמאות כלליות/מומצאות; ידע או ניסוח מעבר לרמת הכיתה באופן עקבי.
- 0-1 סימנים מובהקים → "low"
- 2-3 סימנים מובהקים → "medium"
- 4 ומעלה → "high"
לכל סימן שאתה מדווח — הוסף דוגמה קצרה מהטקסט עצמו. **אסור לקבוע בוודאות** שהעבודה נכתבה ב-AI — תמיד "סימנים המעוררים חשד", לשיקול דעת המורה. אם אין סימנים, כתוב זאת בבירור (low).

נסח את כל המשוב ${teacherTitle}.

**פורמט JSON בלבד, ללא markdown (הערכים כאן הם דוגמת מבנה בלבד — אל תעתיק מהם מספרים):**
{
  "score": 0,
  "max_score": 100,
  "bottom_line": "סיכום קצר של 2-3 משפטים",
  "strengths": ["נקודת חוזק ספציפית עם הפניה למקום בעבודה"],
  "weaknesses": ["איפה בדיוק נחלש / טעה"],
  "sections": [
    { "title": "שם הסעיף במחוון", "feedback": "מה הוגש, מה טוב, מה חסר — ולמה ניתן הניקוד הזה", "points": 0, "max": 0 }
  ],
  "ai_detection": {
    "suspicion_level": "low",
    "signals": ["סימן מובהק + דוגמה קצרה מהטקסט"],
    "note": "הסבר קצר וזהיר למורה - לשיקול דעתה בלבד"
  },
  "confidence": "high"
}
(suspicion_level: "low" / "medium" / "high". score = סכום ה-points של הסעיפים.)`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 8192,
        temperature: 0,
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

    const result = extractJSON(textBlock.text);

    // The final score is computed from the per-section points, normalized to 100.
    // This keeps the grade tied to the rubric breakdown instead of a single
    // model-anchored number, and guards against section maxes not summing to 100.
    if (Array.isArray(result.sections) && result.sections.length > 0) {
      let totalPts = 0, totalMax = 0;
      for (const sec of result.sections) {
        const p = Number(sec.points), m = Number(sec.max);
        if (isFinite(m) && m > 0) {
          totalMax += m;
          totalPts += (isFinite(p) ? Math.min(Math.max(p, 0), m) : 0);
        }
      }
      if (totalMax > 0) result.score = Math.round((totalPts / totalMax) * 100);
    } else if (result.max_score && result.max_score !== 100) {
      result.score = Math.round(result.score * (100 / result.max_score));
    }
    result.score = Math.min(Math.max(Math.round(Number(result.score) || 0), 0), 100);
    result.max_score = 100;

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

// Robustly extract a JSON object from the model's text response.
// Handles code fences and any stray prose before/after the JSON.
function extractJSON(text) {
  let t = (text || '').trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  if (t[0] !== '{') {
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) t = t.slice(start, end + 1);
  }
  return JSON.parse(t);
}

export const config = {
  api: { bodyParser: { sizeLimit: '4mb' } }
};
