// Vercel Serverless Function - Authentication
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

  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'נא למלא מייל וסיסמה' });
    }

    const response = await fetch(`${SUPABASE_URL}/rest/v1/schools?email=eq.${encodeURIComponent(email)}&select=*`, {
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`
      }
    });

    if (!response.ok) {
      return res.status(500).json({ error: 'שגיאת מסד נתונים' });
    }

    const schools = await response.json();
    if (!schools || schools.length === 0) {
      return res.status(401).json({ error: 'מייל לא נמצא במערכת' });
    }

    const school = schools[0];
    if (!school.is_active) {
      return res.status(403).json({ error: 'החשבון אינו פעיל' });
    }
    if (school.password !== password) {
      return res.status(401).json({ error: 'סיסמה שגויה' });
    }

    await fetch(`${SUPABASE_URL}/rest/v1/schools?id=eq.${school.id}`, {
      method: 'PATCH',
      headers: {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({ last_login: new Date().toISOString() })
    });

    return res.status(200).json({
      success: true,
      school: {
        id: school.id,
        email: school.email,
        school_name: school.school_name,
        city: school.city,
        tier: school.tier
      }
    });
  } catch (err) {
    console.error('Auth error:', err);
    return res.status(500).json({ error: err.message || 'Internal error' });
  }
}
