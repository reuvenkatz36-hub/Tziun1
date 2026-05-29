// Vercel Serverless Function - Generated Exams (pending review queue)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'Server not configured' });

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

    // Verify school active
    const schools = await SB(`schools?id=eq.${school_id}&select=is_active`);
    if (!schools.length || !schools[0].is_active) {
      return res.status(403).json({ error: 'Account not active' });
    }

    // ===== SAVE a generated exam (on print) =====
    if (action === 'save') {
      const { subject_id, teacher_id, title, subject, grade, total_points, exam_structure } = payload;
      const result = await SB('generated_exams', {
        method: 'POST',
        body: JSON.stringify({
          school_id, subject_id, teacher_id,
          title, subject, grade,
          total_points: total_points || 100,
          exam_structure,
          status: 'pending'
        })
      });
      return res.status(200).json({ exam: result[0] });
    }

    // ===== LIST pending exams (optionally by subject) =====
    if (action === 'listPending') {
      const { subject_id } = payload;
      let q = `generated_exams?school_id=eq.${school_id}&status=eq.pending&select=*&order=created_at.desc`;
      if (subject_id) q += `&subject_id=eq.${subject_id}`;
      const rows = await SB(q);
      return res.status(200).json({ exams: rows });
    }

    // ===== GET single generated exam =====
    if (action === 'get') {
      const { exam_id } = payload;
      const rows = await SB(`generated_exams?id=eq.${exam_id}&school_id=eq.${school_id}&select=*`);
      if (!rows.length) return res.status(404).json({ error: 'Not found' });
      return res.status(200).json({ exam: rows[0] });
    }

    // ===== MARK as reviewed =====
    if (action === 'markReviewed') {
      const { exam_id } = payload;
      await SB(`generated_exams?id=eq.${exam_id}&school_id=eq.${school_id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'reviewed' }),
        prefer: 'return=minimal'
      });
      return res.status(200).json({ success: true });
    }

    // ===== DELETE a generated exam =====
    if (action === 'delete') {
      const { exam_id } = payload;
      await SB(`generated_exams?id=eq.${exam_id}&school_id=eq.${school_id}`, {
        method: 'DELETE',
        prefer: 'return=minimal'
      });
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('Exams error:', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}

export const config = {
  api: {
    bodyParser: { sizeLimit: '4mb' }
  }
};
