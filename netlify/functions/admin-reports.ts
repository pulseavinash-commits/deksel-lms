import type { Config } from '@netlify/functions';
import { db } from './_lib/db';
import { json, err, csrfCheck } from './_lib/http';
import { requireAdmin } from './_lib/auth';
import type { PublishedCourseSnapshot, ReportRow } from '../../shared/types';

export const config: Config = {
  path: ['/api/admin/reports', '/api/admin/reports/export', '/api/admin/reports/session/:sessionId'],
};

interface Filters {
  from?: string; to?: string; headquarter?: string; designation?: string;
  course_version?: number; status?: string; min_score?: number; max_score?: number;
}

function parseFilters(url: URL): Filters {
  const f: Filters = {};
  const g = (k: string) => url.searchParams.get(k) || undefined;
  f.from = g('from'); f.to = g('to');
  f.headquarter = g('headquarter'); f.designation = g('designation');
  f.status = g('status');
  const v = g('version'); if (v) f.course_version = Number(v);
  const mn = g('min_score'); if (mn) f.min_score = Number(mn);
  const mx = g('max_score'); if (mx) f.max_score = Number(mx);
  return f;
}

async function buildRows(filters: Filters): Promise<ReportRow[]> {
  const d = db();
  let q = d.from('learner_sessions')
    .select('*, learners(*), course_versions(version, snapshot), courses(title)')
    .order('started_at', { ascending: false })
    .limit(2000);
  if (filters.from) q = q.gte('started_at', filters.from);
  if (filters.to) q = q.lte('started_at', filters.to + 'T23:59:59Z');
  if (filters.status) q = q.eq('status', filters.status);
  const { data: sessions, error } = await q;
  if (error) throw new Error(error.message);
  const ids = (sessions ?? []).map((s) => s.id);
  if (ids.length === 0) return [];

  const [{ data: progress }, { data: ratings }] = await Promise.all([
    d.from('slide_progress').select('session_id, state, best_score').in('session_id', ids),
    d.from('ratings').select('*').in('session_id', ids),
  ]);

  const rows: ReportRow[] = [];
  for (const s of sessions ?? []) {
    const learner = s.learners as { name: string; designation: string; headquarter: string; employee_code: string | null };
    if (filters.headquarter && learner.headquarter.toLowerCase() !== filters.headquarter.toLowerCase()) continue;
    if (filters.designation && learner.designation.toLowerCase() !== filters.designation.toLowerCase()) continue;
    const snapshot = (s.course_versions as { version: number; snapshot: PublishedCourseSnapshot }).snapshot;
    const version = (s.course_versions as { version: number }).version;
    if (filters.course_version && version !== filters.course_version) continue;

    const prog = (progress ?? []).filter((p) => p.session_id === s.id);
    const done = prog.filter((p) => p.state === 'slide_completed');
    const scores = done.map((p) => Number(p.best_score)).filter((n) => Number.isFinite(n));
    const overall = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
    if (filters.min_score != null && (overall ?? -1) < filters.min_score) continue;
    if (filters.max_score != null && (overall ?? 101) > filters.max_score) continue;

    const rating = (ratings ?? []).find((r) => r.session_id === s.id);
    rows.push({
      session_id: s.id,
      learner_name: learner.name,
      designation: learner.designation,
      headquarter: learner.headquarter,
      employee_code: learner.employee_code,
      course_title: (s.courses as { title: string }).title,
      course_version: version,
      started_at: s.started_at,
      completed_at: s.completed_at,
      total_elapsed_seconds: s.total_elapsed_seconds,
      active_seconds: s.active_seconds,
      status: s.status,
      slides_completed: done.length,
      slides_total: snapshot.slides.length,
      overall_score: overall,
      rating_overall: rating?.overall ?? null,
      rating_clarity: rating?.clarity ?? null,
      rating_usefulness: rating?.usefulness ?? null,
      feedback: rating?.feedback ?? null,
      last_activity_at: s.last_activity_at,
    });
  }
  return rows;
}

function toCsv(rows: ReportRow[]): string {
  const headers = [
    'Learner name', 'Designation', 'Headquarter', 'Employee code', 'Course', 'Course version',
    'Start time', 'Completion time', 'Total elapsed (min)', 'Active learning (min)', 'Status',
    'Slides completed', 'Slides total', 'Overall score', 'Rating overall', 'Rating clarity',
    'Rating usefulness', 'Feedback', 'Last activity',
  ];
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((r) => [
    r.learner_name, r.designation, r.headquarter, r.employee_code ?? '', r.course_title, r.course_version,
    r.started_at, r.completed_at ?? '', (r.total_elapsed_seconds / 60).toFixed(1), (r.active_seconds / 60).toFixed(1),
    r.status, r.slides_completed, r.slides_total, r.overall_score ?? '', r.rating_overall ?? '',
    r.rating_clarity ?? '', r.rating_usefulness ?? '', r.feedback ?? '', r.last_activity_at,
  ].map(esc).join(','));
  // BOM makes the file open cleanly in Excel.
  return '\uFEFF' + [headers.join(','), ...lines].join('\r\n');
}

export default async function handler(req: Request): Promise<Response> {
  if (!csrfCheck(req)) return err('CSRF check failed', 403);
  const admin = await requireAdmin(req);
  if (!admin) return err('Not authenticated', 401);
  const url = new URL(req.url);

  try {
    // ---- Session detail (questions, transcribed answers, corrective attempts)
    const sm = url.pathname.match(/^\/api\/admin\/reports\/session\/([0-9a-f-]{36})$/);
    if (sm && req.method === 'GET') {
      const d = db();
      const sid = sm[1];
      const [{ data: attempts }, { data: transcripts }, { data: progress }] = await Promise.all([
        d.from('assessment_attempts').select('*').eq('session_id', sid).order('created_at'),
        d.from('transcripts').select('*').eq('session_id', sid).order('created_at').limit(3000),
        d.from('slide_progress').select('*').eq('session_id', sid),
      ]);
      return json({ attempts: attempts ?? [], transcripts: transcripts ?? [], progress: progress ?? [] });
    }

    const filters = parseFilters(url);
    const rows = await buildRows(filters);

    if (url.pathname === '/api/admin/reports/export') {
      return new Response(toCsv(rows), {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="learner-report-${new Date().toISOString().slice(0, 10)}.csv"`,
          'Cache-Control': 'no-store',
        },
      });
    }
    return json({ rows });
  } catch (e) {
    console.error(e);
    return err(e instanceof Error ? e.message : 'Report failed', 500);
  }
}
