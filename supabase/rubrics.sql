-- Tziun — טבלת מחוונים לשימוש חוזר (Reusable grading rubrics)
-- הריצי את הקובץ הזה פעם אחת ב-Supabase: Project → SQL Editor → New query → הדבקה → Run
-- ללא RLS — כל הגישה דרך service key מהשרת (כמו שאר הטבלאות).

create table if not exists rubrics (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null,
  subject_id  uuid,
  teacher_id  uuid,
  name        text not null,
  content     text not null,
  created_at  timestamptz not null default now()
);

-- אינדקס לשליפה מהירה לפי בית ספר + מקצוע
create index if not exists rubrics_school_subject_idx
  on rubrics (school_id, subject_id);
