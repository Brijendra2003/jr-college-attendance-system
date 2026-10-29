'use server';

import { z } from 'zod';
import { action, ActionError, must } from '@/lib/auth/action';
import {
  academicYearSchema, batchSchema, calendarEventSchema, collegeSchema, declareHolidaySchema, divisionSchema, shiftSchema,
} from '@/shared/schemas';
import { todayIST } from '@/shared/dates';

export const saveCollege = action({
  permission: 'settings.manage',
  scopes: ['all'],
  schema: collegeSchema,
  message: 'College profile saved.',
  async run({ input, supabase }) {
    must(await supabase.from('college').upsert({ id: 1, ...input }, { onConflict: 'id' }));
  },
});

export const applyTemplate = action({
  permission: 'structure.manage',
  scopes: ['all'],
  schema: z.object({}),
  message: (d: { subjects_added: number }) => `MSBSHSE template applied (${d.subjects_added} subjects added).`,
  async run({ supabase }) {
    return must(await supabase.rpc('apply_msbshse_template')) as { subjects_added: number };
  },
});

export const createAcademicYear = action({
  permission: 'structure.manage',
  scopes: ['all'],
  schema: academicYearSchema,
  message: 'Academic year created.',
  async run({ input, supabase }) {
    if (input.activate) {
      must(await supabase.from('academic_years').update({ status: 'archived' }).eq('status', 'active'));
    }
    const year = must(
      await supabase
        .from('academic_years')
        .insert({ label: input.label, starts_on: input.starts_on, ends_on: input.ends_on, status: input.activate ? 'active' : 'planned' })
        .select('id')
        .single(),
    ) as { id: string };
    must(
      await supabase.from('academic_terms').insert([
        { academic_year_id: year.id, seq: 1, name: 'First term', starts_on: input.starts_on, ends_on: input.term1_ends_on },
        { academic_year_id: year.id, seq: 2, name: 'Second term', starts_on: input.term2_starts_on, ends_on: input.ends_on },
      ]),
    );
    return year;
  },
});

export const setYearStatus = action({
  permission: 'structure.manage',
  scopes: ['all'],
  schema: z.object({ id: z.uuid(), status: z.enum(['planned', 'active', 'archived']) }),
  message: 'Year status updated.',
  async run({ input, supabase }) {
    if (input.status === 'active') {
      must(await supabase.from('academic_years').update({ status: 'archived' }).eq('status', 'active').neq('id', input.id));
    }
    must(await supabase.from('academic_years').update({ status: input.status }).eq('id', input.id));
  },
});

export const createShift = action({
  permission: 'structure.manage',
  scopes: ['all'],
  schema: shiftSchema,
  message: 'Shift saved.',
  async run({ input, supabase }) {
    must(await supabase.from('shifts').insert(input));
  },
});

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export const createDivisions = action({
  permission: 'structure.manage',
  scopes: ['all'],
  schema: divisionSchema.omit({ code: true }).extend({ count: z.coerce.number().int().min(1).max(20) }),
  message: (n: number) => `${n} division(s) created.`,
  async run({ input, supabase }) {
    const [{ data: std }, { data: stream }, { data: existing }] = await Promise.all([
      supabase.from('standards').select('code').eq('id', input.standard_id).single(),
      supabase.from('streams').select('code').eq('id', input.stream_id).single(),
      supabase.from('divisions').select('code').eq('academic_year_id', input.academic_year_id)
        .eq('standard_id', input.standard_id).eq('stream_id', input.stream_id),
    ]);
    if (!std || !stream) throw new ActionError('Unknown standard or stream.');
    const used = new Set((existing ?? []).map((d: { code: string }) => d.code));
    const codes = [...LETTERS].filter((c) => !used.has(c)).slice(0, input.count);
    const rows = codes.map((code) => ({
      academic_year_id: input.academic_year_id,
      standard_id: input.standard_id,
      stream_id: input.stream_id,
      medium_code: input.medium_code,
      code,
      name: `${std.code}-${stream.code}-${code}`,
      capacity: input.capacity,
      shift_id: input.shift_id ?? null,
    }));
    must(await supabase.from('divisions').insert(rows));
    return rows.length;
  },
});

export const updateDivision = action({
  permission: 'structure.manage',
  scopes: ['all'],
  schema: z.object({ id: z.uuid(), capacity: z.coerce.number().int().min(1).max(250), shift_id: z.uuid().or(z.literal('')).transform((v) => v || null) }),
  message: 'Division updated.',
  async run({ input, supabase }) {
    must(await supabase.from('divisions').update({ capacity: input.capacity, shift_id: input.shift_id }).eq('id', input.id));
  },
});

export const createBatch = action({
  permission: 'structure.manage',
  scopes: ['all'],
  schema: batchSchema,
  message: 'Batch created.',
  async run({ input, supabase }) {
    must(await supabase.from('batches').insert(input));
  },
});

export const addCalendarEvent = action({
  permission: 'calendar.manage',
  scopes: ['all'],
  schema: calendarEventSchema.and(z.object({ academic_year_id: z.uuid() })),
  message: 'Calendar updated.',
  async run({ input, supabase, viewer }) {
    must(await supabase.from('academic_calendar_events').insert({ ...input, created_by: viewer.userId }));
  },
});

export const deleteCalendarEvent = action({
  permission: 'calendar.manage',
  scopes: ['all'],
  schema: z.object({ id: z.uuid() }),
  message: 'Event removed.',
  async run({ input, supabase }) {
    const ev = must(await supabase.from('academic_calendar_events').select('starts_on, kind').eq('id', input.id).single()) as { starts_on: string; kind: string };
    if (ev.starts_on <= todayIST() && ev.kind !== 'exam_block' && ev.kind !== 'event') {
      throw new ActionError('Past holidays cannot be removed here: registers for those dates were voided. Use a working-day override instead.');
    }
    must(await supabase.from('academic_calendar_events').delete().eq('id', input.id));
  },
});

export const declareHoliday = action({
  permission: 'calendar.manage',
  scopes: ['all'],
  schema: declareHolidaySchema,
  message: (d: { voided_day_registers: number }) => `Holiday declared. ${d.voided_day_registers} day register(s) voided.`,
  async run({ input, supabase }) {
    return must(
      await supabase.rpc('declare_holiday', {
        p_date: input.date,
        p_title: input.title,
        p_division_ids: input.divisionIds?.length ? input.divisionIds : null,
        p_kind: input.kind,
      }),
    ) as { voided_day_registers: number };
  },
});

export const completeSetup = action({
  permission: 'settings.manage',
  scopes: ['all'],
  schema: z.object({}),
  message: 'Setup complete. Welcome!',
  async run({ supabase }) {
    const [{ data: college }, { count: years }, { count: divisions }, { count: policies }] = await Promise.all([
      supabase.from('college').select('id').maybeSingle(),
      supabase.from('academic_years').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('divisions').select('id', { count: 'exact', head: true }),
      supabase.from('attendance_policies').select('id', { count: 'exact', head: true }),
    ]);
    const missing = [
      !college && 'college profile',
      !years && 'an active academic year',
      !divisions && 'at least one division',
      !policies && 'an attendance policy',
    ].filter(Boolean);
    if (missing.length) throw new ActionError(`Still needed: ${missing.join(', ')}.`);
    must(await supabase.from('college').update({ setup_completed_at: new Date().toISOString() }).eq('id', 1));
  },
});
