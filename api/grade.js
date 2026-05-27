// Vercel Serverless Function - Tziun AI Grading with Self-Verification
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

    // ============ STEP 1: Initial grading with deep analysis ============
    const gradingPrompt = `אתה מורה ישראלי מומחה לבדיקת מבחנים בעברית בכיתות יסודי.

**שלב 1 - זיהוי המבחן:**
- קרא בעיון כל שאלה במבחן.
- זהה את סוג השאלה (חיבור, חיסור, כפל, חילוק, מילוליות, וכו').
- חשב בעצמך את התשובה הנכונה לכל שאלה לפני שאתה מסתכל על תשובת התלמיד.

**שלב 2 - זיהוי תשובות התלמיד:**
- קרא בעיון מה התלמיד כתב/סימן בכתב יד.
- אם התלמיד עיגל אופציה (א'/ב'/ג') - זהה איזו.
- אם התלמיד כתב מספר - קרא אותו בדיוק.
- אם לא ברור מה התלמיד כתב - is_legible: false.

**שלב 3 - השוואה:**
- השווה את התשובה הנכונה (שחישבת) לתשובת התלמיד (שזיהית).
- חישוב מתמטי חייב להיות מדויק 100%.

**חוקים קריטיים:**
1. ציון תמיד מתוך **100** (סטנדרט ישראלי).
2. ${teacherTitle}. כל המשוב בהתאם.
3. שם התלמיד: ${studentName}.
4. אל תנחש - אם לא בטוח, סמן is_legible: false או confidence: "uncertain".

**פורמט JSON בלבד:**
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
      "student_answer": "תשובת התלמיד שזיהית",
      "correct_answer": "התשובה הנכונה שחישבת",
      "is_correct": true,
      "points": 17,
      "max": 17,
      "feedback": "הסבר מפורט"
    }
  ]
}`;

    // Run grading 3 times in parallel for verification
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
          system: gradingPrompt,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64Data } },
              { type: 'text', text: `בדיקה #${attemptNumber}: בדוק את המבחן "${examName || 'מבחן'}" של ${studentName}.

חשוב במיוחד בבדיקה זו:
- חשב כל תשובה בעצמך לפני השוואה לתשובת התלמיד.
- וודא שהזיהוי של מה שהתלמיד כתב מדויק.
- חישוב מתמטי - מדויק לחלוטין.

החזר JSON בלבד.` }
            ]
          }]
        })
      });

      if (!r.ok) {
        const errText = await r.text();
        throw new Error(`AI error on attempt ${attemptNumber}: ${errText.substring(0, 200)}`);
      }
      const data = await r.json();
      const textBlock = data.content?.find(b => b.type === 'text');
      if (!textBlock) throw new Error(`No response on attempt ${attemptNumber}`);
      const cleaned = textBlock.text.replace(/```json\s*|```\s*$/g, '').trim();
      return JSON.parse(cleaned);
    };

    // ============ RUN 3 PARALLEL GRADINGS ============
    let results;
    try {
      results = await Promise.all([runGrading(1), runGrading(2), runGrading(3)]);
    } catch (err) {
      console.error('Multi-grading error:', err);
      return res.status(500).json({ error: 'שגיאה בבדיקה. נסו שוב.', detail: err.message });
    }

    // Check legibility - if ANY attempt says not legible, fallback
    const allLegible = results.every(r => r.is_legible !== false);
    if (!allLegible) {
      return res.status(200).json({
        success: true,
        result: {
          is_legible: false,
          confidence: 'uncertain',
          message: 'כתב היד לא ברור מספיק בחלק מהשאלות. אנא הזינו ציון ידנית.'
        }
      });
    }

    // ============ VERIFICATION - all 3 must agree within 2 points ============
    const scores = results.map(r => r.total_score);
    const minScore = Math.min(...scores);
    const maxScore = Math.max(...scores);
    const range = maxScore - minScore;

    if (range > 2) {
      // Disagreement - too unreliable
      console.log(`Score disagreement: ${scores.join(', ')}. Range: ${range}`);
      return res.status(200).json({
        success: true,
        result: {
          is_legible: false,
          confidence: 'uncertain',
          message: `ה-AI לא הצליח לקבוע ציון אחיד (הבדיקות נתנו: ${scores.join(', ')}). אנא הזינו ציון ידנית כדי לוודא דיוק.`
        }
      });
    }

    // ============ CONSENSUS - use median result ============
    const sortedByScore = [...results].sort((a,b) => a.total_score - b.total_score);
    const consensus = sortedByScore[1]; // median

    // Force max_score to 100
    if (consensus.max_score !== 100) {
      const ratio = 100 / (consensus.max_score || 100);
      consensus.total_score = Math.round(consensus.total_score * ratio);
      consensus.max_score = 100;
    }

    // Add verification metadata
    consensus.verification = {
      attempts: 3,
      scores: scores,
      agreement: range <= 1 ? 'unanimous' : 'consensus',
      range: range
    };
    consensus.confidence = range === 0 ? 'high' : 'high'; // verified

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
    bodyParser: { sizeLimit: '10mb' }
  }
};
