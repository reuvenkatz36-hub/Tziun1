// Vercel Serverless Function - Tziun AI Grading
// Mode A: known exam structure (answers as text) - from Tziun-generated exams
// Mode B: answer key image - legacy fallback
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  try {
    const { studentImage, answerKeyImage, examStructure, studentName, examName, teacherGender, school_id, student_id } = req.body;
    if (!studentImage || !studentName) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (!examStructure && !answerKeyImage) {
      return res.status(400).json({ error: 'Missing answer key or exam structure' });
    }

    const studentB64 = studentImage.replace(/^data:image\/\w+;base64,/, '');
    const teacherTitle = teacherGender === 'female' ? 'בלשון נקבה' : 'בלשון זכר';

    // Build the answer reference
    let answerReference = '';
    let questionCount = 0;
    if (examStructure && examStructure.questions) {
      questionCount = examStructure.questions.length;
      answerReference = examStructure.questions.map(q => {
        if (q.has_parts && q.parts && q.parts.length) {
          const parts = q.parts.map(p => `   סעיף ${p.label} (${p.points} נק'): ${p.text}\n   תשובה נכונה: ${p.correct_answer}`).join('\n');
          return `שאלה ${q.number} (${q.points} נק') - ${q.text}\n${parts}`;
        }
        return `שאלה ${q.number} (${q.points} נק'): ${q.text}\n   תשובה נכונה: ${q.correct_answer}`;
      }).join('\n\n');
    }

    const systemPrompt = `אתה מורה ישראלי מומחה לבדיקת מבחנים בעברית בכיתות יסודי.

**משימה: בדיקת מבחן של ${studentName} מול התשובות הנכונות הידועות.**

${examStructure ? `יש לך את **מבנה המבחן המלא והתשובות הנכונות** (המבחן נוצר על-ידי המערכת, אז התשובות ודאיות):

${answerReference}

**הניקוד כבר ידוע** - כל שאלה והסעיפים שלה כבר עם הניקוד שלהם למעלה. אל תשנה אותו.` : ''}

**איך לבדוק:**
1. קרא מהתמונה מה התלמיד כתב בכל תיבת תשובה.
2. השווה לתשובה הנכונה הידועה.
3. שפוט אם תשובת התלמיד **תואמת רעיונית** לתשובה הנכונה - לא חייב להיות זהה מילולית!
   - "81 ÷ 9 = 9" שווה ל "81/9 = 9"
   - תשובה בניסוח שונה אבל אותו רעיון = נכונה
   - תשובה חלקית = ניקוד יחסי מתוך ניקוד השאלה/סעיף
4. סכום הנקודות = הציון הסופי.

**חוקים קריטיים:**
- **חובה לציין בבירור באילו שאלות/סעיפים התלמיד טעה.**
- בשדה weaknesses רשום רשימה מפורשת, למשל: "שאלה 3 - טעות בחישוב", "שאלה 5 סעיף ב - לא ענה".
- בשדה errors_summary רשום רק את מספרי השאלות/סעיפים השגויים, למשל: ["שאלה 3", "שאלה 5ב"].
- **קרא בעיון את כל תיבות התשובה** - אל תפספס שאלות.
- אם תיבת תשובה ריקה = התלמיד לא ענה = 0 נקודות לאותה שאלה.
- אם כתב היד בתיבה מסוימת לא קריא, סמן באותה שאלה is_correct: "unclear" ותן 0, וציין זאת ב-weaknesses.
- רק אם **רוב** המבחן לא קריא, סמן is_legible: false.
- ${teacherTitle}. ניסוח המשוב בהתאם.

**פורמט JSON בלבד, ללא markdown:**
{
  "total_score": 75,
  "max_score": 100,
  "bottom_line": "סיכום של 2-3 משפטים",
  "strengths": ["נקודת חוזק"],
  "weaknesses": ["שאלה 3 - טעות בחישוב"],
  "errors_summary": ["שאלה 3"],
  "confidence": "high",
  "is_legible": true,
  "questions": [
    {
      "number": 1,
      "question_text": "מה השאלה",
      "has_parts": false,
      "correct_answer": "התשובה הנכונה",
      "student_answer": "מה התלמיד כתב",
      "is_correct": "full",
      "points": 25,
      "max": 25,
      "feedback": "הסבר קצר",
      "parts": []
    }
  ]
}
(is_correct: "full" / "partial" / "wrong" / "unclear")`;

    const userContent = [];
    if (answerKeyImage && !examStructure) {
      const keyB64 = answerKeyImage.replace(/^data:image\/\w+;base64,/, '');
      userContent.push({ type: 'text', text: 'תמונה 1: מפתח תשובות (פתרון מלא 100/100):' });
      userContent.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: keyB64 } });
      userContent.push({ type: 'text', text: `תמונה 2: מבחן של ${studentName}:` });
    } else {
      userContent.push({ type: 'text', text: `מבחן של ${studentName} (התשובות הנכונות ידועות לך מהמבנה למעלה):` });
    }
    userContent.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: studentB64 } });
    userContent.push({ type: 'text', text: 'בדוק את המבחן והחזר JSON בלבד.' });

    const runGrading = async () => {
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
          messages: [{ role: 'user', content: userContent }]
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

    // Run twice in parallel for verification
    let results;
    try {
      results = await Promise.all([runGrading(), runGrading()]);
    } catch (err) {
      console.error('Grading error:', err);
      return res.status(500).json({ error: 'שגיאה בבדיקה. נסו שוב.', detail: err.message });
    }

    const allLegible = results.every(r => r.is_legible !== false);
    if (!allLegible) {
      return res.status(200).json({
        success: true,
        result: { is_legible: false, confidence: 'uncertain', message: 'רוב המבחן לא ברור מספיק. אנא הזינו ציון ידנית.' }
      });
    }

    const scores = results.map(r => r.total_score);
    const range = Math.max(...scores) - Math.min(...scores);

    // With known answers, the two runs should agree closely. Allow small gap.
    if (range > 6) {
      return res.status(200).json({
        success: true,
        result: { is_legible: false, confidence: 'uncertain', message: `הבדיקה לא הגיעה לתוצאה אחידה (${scores.join(', ')}). אנא הזינו ידנית.` }
      });
    }

    // Use the run with more detail (more questions filled), fallback to first
    let consensus = results[0];
    if ((results[1].questions?.length || 0) > (results[0].questions?.length || 0)) consensus = results[1];
    consensus.total_score = Math.round((scores[0] + scores[1]) / 2);

    if (consensus.max_score !== 100) {
      const ratio = 100 / (consensus.max_score || 100);
      consensus.total_score = Math.round(consensus.total_score * ratio);
      consensus.max_score = 100;
    }

    consensus.verification = { attempts: 2, scores };

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
  api: { bodyParser: { sizeLimit: '15mb' } }
};
