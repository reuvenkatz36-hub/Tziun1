// Vercel Serverless Function - Admin Dashboard
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

  if (!SUPABASE_URL || !SERVICE_KEY || !ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'Server not configured' });
  }

  try {
    const { password, action, ...payload } = req.body;

    if (password !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'גישה לא מורשית' });
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

    // ============ ADD SCHOOL ============
    if (action === 'addSchool') {
      const { email, password: schoolPass, school_name, city, tier } = payload;
      const result = await SB('schools', {
        method: 'POST',
        body: JSON.stringify({
          email, password: schoolPass, school_name, city,
          tier: tier || 'trial', is_active: true
        })
      });
      return res.status(200).json({ school: result[0] });
    }

    // ============ TOGGLE SCHOOL ACTIVE ============
    if (action === 'toggleActive') {
      const { school_id, is_active } = payload;
      await SB(`schools?id=eq.${school_id}`, {
        method: 'PATCH',
        body: JSON.stringify({ is_active }),
        prefer: 'return=minimal'
      });
      return res.status(200).json({ success: true });
    }

    // ============ DELETE SCHOOL ============
    if (action === 'deleteSchool') {
      const { school_id } = payload;
      await SB(`schools?id=eq.${school_id}`, {
        method: 'DELETE',
        prefer: 'return=minimal'
      });
      return res.status(200).json({ success: true });
    }

    // ============ DASHBOARD ============
    // Default: return dashboard stats
    const [schools, allExams, allAI] = await Promise.all([
      SB('schools?select=*&order=created_at.desc'),
      SB('exams?select=id,school_id,source,created_at'),
      SB('ai_usage?select=id,school_id,created_at')
    ]);

    // Calculate stats per school
    const now = new Date();
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const enrichedSchools = schools.map(s => {
      const schoolExams = allExams.filter(e => e.school_id === s.id);
      const schoolAI = allAI.filter(a => a.school_id === s.id);
      const aiThisMonth = schoolAI.filter(a => new Date(a.created_at) >= thisMonth).length;
      const examsThisMonth = schoolExams.filter(e => new Date(e.created_at) >= thisMonth).length;
      return {
        ...s,
        total_exams: schoolExams.length,
        total_ai: schoolAI.length,
        ai_this_month: aiThisMonth,
        exams_this_month: examsThisMonth
      };
    });

    // Totals
    const aiThisMonthTotal = allAI.filter(a => new Date(a.created_at) >= thisMonth).length;
    const examsThisMonthTotal = allExams.filter(e => new Date(e.created_at) >= thisMonth).length;

    return res.status(200).json({
      schools: enrichedSchools,
      stats: {
        total_schools: schools.length,
        active_schools: schools.filter(s => s.is_active).length,
        total_exams: allExams.length,
        total_ai: allAI.length,
        ai_this_month: aiThisMonthTotal,
        exams_this_month: examsThisMonthTotal
      }
    });
  } catch (err) {
    console.error('Admin error:', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
