// Vercel Serverless Function - Data CRUD operations
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return res.status(500).json({ error: 'Server not configured' });
  }

  const SB = async (path, opts = {}) => {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      ...opts,
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': opts.prefer || 'return=representation',
        ...opts.headers
      }
    });
    if (!r.ok) {
      const t = await r.text();
      throw new Error(`Supabase ${r.status}: ${t}`);
    }
    if (opts.prefer === 'return=minimal') return null;
    return r.json();
  };

  try {
    const { action, school_id, ...payload } = req.body;

    if (!school_id) return res.status(400).json({ error: 'Missing school_id' });

    // Verify school is active
    const schools = await SB(`schools?id=eq.${school_id}&select=is_active`);
    if (!schools.length || !schools[0].is_active) {
      return res.status(403).json({ error: 'Account not active' });
    }

    // ============ LOAD - get all school data ============
    if (action === 'load') {
      const [profiles, classes, subjects, students, exams] = await Promise.all([
        SB(`teacher_profiles?school_id=eq.${school_id}&select=*&order=created_at.asc`),
        SB(`classes?school_id=eq.${school_id}&select=*&order=created_at.asc`),
        SB(`subjects?select=*,classes!inner(school_id)&classes.school_id=eq.${school_id}`),
        SB(`students?select=*,classes!inner(school_id)&classes.school_id=eq.${school_id}`),
        SB(`exams?school_id=eq.${school_id}&select=*&order=created_at.desc`)
      ]);
      return res.status(200).json({ profiles, classes, subjects, students, exams });
    }

    // ============ CREATE PROFILE ============
    if (action === 'createProfile') {
      const { name, gender, color, is_homeroom } = payload;
      const result = await SB('teacher_profiles', {
        method: 'POST',
        body: JSON.stringify({ school_id, name, gender, color, is_homeroom })
      });
      return res.status(200).json({ profile: result[0] });
    }

    // ============ CREATE CLASS (with students and subjects) ============
    if (action === 'createClass') {
      const { name, grade, students_list, subjects_list, teacher_id } = payload;

      // Create class
      const classResult = await SB('classes', {
        method: 'POST',
        body: JSON.stringify({ school_id, name, grade })
      });
      const classId = classResult[0].id;

      // Create students
      if (students_list && students_list.length > 0) {
        await SB('students', {
          method: 'POST',
          body: JSON.stringify(students_list.map(n => ({ class_id: classId, name: n }))),
          prefer: 'return=minimal'
        });
      }

      // Create subjects
      if (subjects_list && subjects_list.length > 0 && teacher_id) {
        await SB('subjects', {
          method: 'POST',
          body: JSON.stringify(subjects_list.map(s => ({ class_id: classId, teacher_id, name: s.name, sym: s.sym }))),
          prefer: 'return=minimal'
        });
      }

      return res.status(200).json({ class_id: classId });
    }

    // ============ ADD STUDENT (to existing class) ============
    if (action === 'addStudent') {
      const { class_id, name } = payload;
      if (!class_id || !name) return res.status(400).json({ error: 'Missing class_id or name' });
      // Verify the class belongs to this school
      const cls = await SB(`classes?id=eq.${class_id}&school_id=eq.${school_id}&select=id`);
      if (!cls.length) return res.status(403).json({ error: 'Class not found' });
      const result = await SB('students', {
        method: 'POST',
        body: JSON.stringify({ class_id, name })
      });
      return res.status(200).json({ student: result[0] });
    }

    // ============ RUBRICS (reusable grading criteria) ============
    if (action === 'listRubrics') {
      const { subject_id } = payload;
      let q = `rubrics?school_id=eq.${school_id}&select=*&order=created_at.desc`;
      if (subject_id) q += `&subject_id=eq.${subject_id}`;
      const rows = await SB(q);
      return res.status(200).json({ rubrics: rows });
    }

    if (action === 'saveRubric') {
      const { subject_id, teacher_id, name, content } = payload;
      if (!name || !content) return res.status(400).json({ error: 'Missing name or content' });
      const result = await SB('rubrics', {
        method: 'POST',
        body: JSON.stringify({ school_id, subject_id, teacher_id, name, content })
      });
      return res.status(200).json({ rubric: result[0] });
    }

    if (action === 'deleteRubric') {
      const { rubric_id } = payload;
      await SB(`rubrics?id=eq.${rubric_id}&school_id=eq.${school_id}`, {
        method: 'DELETE',
        prefer: 'return=minimal'
      });
      return res.status(200).json({ success: true });
    }

    // ============ SAVE EXAM ============
    if (action === 'saveExam') {
      const { student_id, subject_id, exam_name, exam_date, score, source, ai_data } = payload;
      const result = await SB('exams', {
        method: 'POST',
        body: JSON.stringify({ student_id, subject_id, school_id, exam_name, exam_date, score, source, ai_data })
      });
      return res.status(200).json({ exam: result[0] });
    }

    // ============ SAVE MULTIPLE EXAMS (manual entry) ============
    if (action === 'saveExamsBulk') {
      const { exams_list } = payload;
      const withSchool = exams_list.map(e => ({ ...e, school_id }));
      const result = await SB('exams', {
        method: 'POST',
        body: JSON.stringify(withSchool)
      });
      return res.status(200).json({ count: result.length });
    }

    // ============ LOG AI USAGE ============
    if (action === 'logAI') {
      const { student_id } = payload;
      await SB('ai_usage', {
        method: 'POST',
        body: JSON.stringify({ school_id, student_id }),
        prefer: 'return=minimal'
      });
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('Data error:', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
