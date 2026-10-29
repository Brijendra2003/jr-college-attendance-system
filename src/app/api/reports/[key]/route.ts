import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import { can, getViewer } from '@/lib/auth/viewer';
import { createClient } from '@/lib/supabase/server';
import { getYearContext } from '@/features/academics/context';
import { REPORTS } from '@/features/reports/builders';
import { formatDateTime } from '@/shared/dates';

/**
 * Report exports: /api/reports/<key>?format=xlsx|csv&…filters.
 * Rows come through the request-scoped client, so RLS limits them to the caller's scope.
 * Every export of personal data is audited; government-format exports are also logged in govt_exports.
 */
export async function GET(request: Request, ctx: RouteContext<'/api/reports/[key]'>) {
  const { key } = await ctx.params;
  const def = REPORTS[key];
  if (!def) return new Response('Unknown report', { status: 404 });
  const viewer = await getViewer();
  if (!viewer) return new Response('Sign in required', { status: 401 });
  if (!can(viewer, def.permission)) return new Response('Not permitted', { status: 403 });

  const url = new URL(request.url);
  const format = url.searchParams.get('format') === 'csv' ? 'csv' : 'xlsx';
  const { year } = await getYearContext();
  if (!year) return new Response('No academic year', { status: 400 });
  const supabase = await createClient();

  let sheet;
  try {
    sheet = await def.build({ supabase, params: url.searchParams, yearId: year.id });
  } catch (e) {
    return new Response(e instanceof Error && e.message === 'NOT_FOUND' ? 'Not found' : 'Could not build the report', { status: 400 });
  }

  const filters = Object.fromEntries(url.searchParams.entries());
  const { error: logError } = await supabase.rpc('log_export', {
    p_report: key, p_filters: { ...filters, format }, p_rows: sheet.rows.length, p_govt_kind: def.govt ?? null,
  });
  // No audit entry, no export.
  if (logError) return new Response('Export could not be logged', { status: 403 });

  const watermark = `Exported by ${viewer.displayName} on ${formatDateTime(new Date())} · ${sheet.rows.length} rows · contains personal data of minors: handle per college policy`;
  const filename = `${sheet.title.replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || key}`;

  if (format === 'csv') {
    const csv = Papa.unparse({ fields: sheet.columns.map((c) => c.header), data: sheet.rows.map((r) => sheet.columns.map((c) => r[c.key] ?? '')) });
    return new Response(`﻿${csv}\n\n"${watermark}"\n`, {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}.csv"`, 'Cache-Control': 'no-store' },
    });
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Jr College Attendance';
  const ws = wb.addWorksheet(sheet.title.slice(0, 31) || 'Report', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = sheet.columns.map((c) => ({ header: c.header, key: c.key, width: c.width ?? 12 }));
  ws.getRow(1).font = { bold: true };
  ws.addRows(sheet.rows);
  ws.addRow([]);
  ws.addRow([watermark]).font = { italic: true, color: { argb: 'FF6B7280' } };
  const buffer = await wb.xlsx.writeBuffer();
  return new Response(buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  });
}
