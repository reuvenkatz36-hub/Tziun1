// Vercel Serverless Function - Tziun AI Grading with Answer Key Comparison
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  try {
    const { studentImage, answerKeyImage, studentName, examName, teacherGender, school_id, student_id } = req.body;
    if (!studentImage || !answerKeyImage || !studentName) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const studentB64 = studentImage.replace(/^data:image\/\w+;base64,/, '');
    const keyB64 = answerKeyImage.replace(/^data:image\/\w+;base64,/, '');
    const teacherTitle = teacherGender === 'female' ? 'בלשון נקבה' : 'בלשון זכר';

    const systemPrompt = `אתה מורה ישראלי מומחה לבדיקת מבחנים בעברית בכיתות יסודי.

**משימה: השוואה רעיונית בין שני מבחנים**

קיבלת **שתי תמונות**:
1. **מפתח תשובות**: מבחן פתור על-ידי המורה (ציון מלא 100/100)
2. **מבחן תלמיד**: מבחן של ${studentName} שצריך לבדוק

**איך לבדוק:**

1. **זהה את כל השאלות** במפתח התשובות.
2. **חלק את 100 הנקודות בשווה** בין השאלות. למשל: 5 שאלות = 20 נקודות לכל אחת. 8 שאלות = 12.5 נקודות לכל אחת.
3. **לכל שאלה במבחן התלמיד:**
   - הבן מה התלמיד ענה.
   - הבן מה התשובה הנכונה (מהמפתח).
   - שפוט אם התשובות **תואמות רעיונית** (לא חייב להיות זהה מילולית או מבחינה ויזואלית).
   - אפשרויות: נכון מלא / נכון חלקית / שגוי.
4. **חישוב סופי**: סכום הנקודות לכל שאלה.

**חוקים קריטיים:**
- **השוואה רעיונית**: אם התלמיד כתב את התשובה הנכונה בדרך שונה - זה נכון!
  - "81 ÷ 9 = 9" שווה ל "81/9 = 9"
  - תשובה בעברית בניסוח שונה אבל אותו רעיון - נכונה
- **תשובה חלקית**: אם התלמיד הבין חלק מהרעיון - תן ניקוד יחסי (לדוגמה: 5/10).
- **בכל שאלה - הסבר מה התלמיד ענה ומה הציון בפועל.**
- **לא ברור?** אם כתב היד באמת לא ניתן לקריאה, סמן is_legible: false.
- ${teacherTitle}. ניסוח המשוב בהתאם.

**פורמט JSON בלבד:**
{
  "total_score": 75,
  "max_score": 100,
  "bottom_line": "סיכום של 2-3 משפטים",
  "strengths": ["נקודת חוזק ספציפית"],
  "weaknesses": ["נקודה לחיזוק ספציפית"],
  "confidence": "high",
  "is_legible": true,
  "questions": [
    {
      "number": 1,
      "question_text": "מה השאלה",
      "correct_answer": "תשובה נכונה מהמפתח",
      "student_answer": "מה התלמיד כתב",
      "is_correct": "full" / "partial" / "wrong",
      "points": 17,
      "max": 20,
      "feedback": "הסבר מפורט - למה הציון הזה"
    }
  ]
}`;

    // Run TWO independent gradings for verification
    const runGrading = async (attemptNumber) => {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
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
              { type: 'text', text: 'תמונה 1: מפתח תשובות (פתרון המורה - 100/100):' },
              { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: keyB64 } },
              { type: 'text', text: `תמונה 2: מבחן של ${studentName}:` },
              { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: studentB64 } },
              { type: 'text', text: `בדיקה #${attemptNumber}: השווה את תשובות התלמיד למפתח התשובות. תן ציון לכל שאלה לפי התאמה רעיונית. החזר JSON בלבד.` }
            ]
          }]
        })
      });

      if (!r.ok) {
        const errText = await r.text();
        throw new Error(`AI error: ${errText.substring(0, 200)}`);
      }
      const data = await r.json();
      const textBlock = data.content?.find(b => b.type === 'text');
      if (!textBlock) throw new Error('No response');
      const cleaned = textBlock.text.replace(/```json\s*|```\s*$/g, '').trim();
      return JSON.parse(cleaned);
    };

    // Run 2 times in parallel for verification
    let results;
    try {
      results = await Promise.all([runGrading(1), runGrading(2)]);
    } catch (err) {
      console.error('Multi-grading error:', err);
      return res.status(500).json({ error: 'שגיאה בבדיקה. נסו שוב.', detail: err.message });
    }

    // Check legibility
    const allLegible = results.every(r => r.is_legible !== false);
    if (!allLegible) {
      return res.status(200).json({
        success: true,
        result: {
          is_legible: false,
          confidence: 'uncertain',
          message: 'כתב היד לא ברור מספיק. אנא הזינו ציון ידנית.'
        }
      });
    }

    // Check agreement between the 2 grades
    const scores = results.map(r => r.total_score);
    const range = Math.max(...scores) - Math.min(...scores);

    if (range > 5) {
      return res.status(200).json({
        success: true,
        result: {
          is_legible: false,
          confidence: 'uncertain',
          message: `ה-AI לא הצליח לקבוע ציון מדויק (הבדיקות נתנו: ${scores.join(', ')}). אנא הזינו ידנית.`
        }
      });
    }

    // Use the average / consensus
    const avgScore = Math.round(scores.reduce((a,b) => a+b, 0) / scores.length);
    const consensus = { ...results[0], total_score: avgScore };

    // Force max_score to 100
    if (consensus.max_score !== 100) {
      const ratio = 100 / (consensus.max_score || 100);
      consensus.total_score = Math.round(consensus.total_score * ratio);
      consensus.max_score = 100;
    }

    consensus.verification = {
      attempts: 2,
      scores: scores,
      range: range
    };

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

    return res.status(200).json({ success: true, result: consensus });
  } catch (err) {
    console.error('Grading error:', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}

export const config = {
  api: {
    bodyParser: { sizeLimit: '15mb' }
  }
};
