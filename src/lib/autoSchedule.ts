import { prisma } from "@/lib/db";
import { DAY_ORDER } from "@/lib/days";
import type { DayOfWeek, Room, TimeSlot } from "@prisma/client";

type Lesson = {
  classGroupId: string;
  subjectId: string;
  teacherId: string;
  preferredRoomId: string | null;
};

type Placement = { lesson: Lesson; slotId: string; roomId: string };

export type GenerateResult =
  | { success: true; placedCount: number; relaxedDailyCap: boolean }
  | { success: false; reason: string };

const MAX_BACKTRACK_STEPS = 300_000;
const MAX_PERIODS_PER_DAY = 3;
const MAX_ATTEMPTS_PER_PASS = 6;

/**
 * Regenerates the entire timetable for an organization from its curriculum
 * requirements (class/subject/teacher/periods-per-week) and constraints
 * (teacher unavailability, room count). Replaces all existing entries.
 *
 * Each class's periods on a given day are always kept contiguous — a period
 * can only be added if it's immediately before or after the periods that
 * class already has that day (e.g. 2,3,4 is fine; 2,4 with a gap at 3 is
 * not), so there's never a free period in the middle of a class's day. The
 * block can start anywhere, not just period 1. On top of that, each class
 * is capped at MAX_PERIODS_PER_DAY per day; if that cap makes the whole
 * curriculum infeasible, generation is retried once with the cap lifted
 * (contiguity is always kept) so a schedule is still produced where
 * possible.
 */
export async function generateSchedule(organizationId: string): Promise<GenerateResult> {
  const [requirements, timeSlots, rooms, unavailability] = await Promise.all([
    prisma.curriculumRequirement.findMany({ where: { organizationId } }),
    prisma.timeSlot.findMany({ where: { organizationId } }),
    prisma.room.findMany({ where: { organizationId } }),
    prisma.teacherUnavailability.findMany({ where: { organizationId } }),
  ]);

  if (requirements.length === 0) {
    return { success: false, reason: "カリキュラム(担当教員・週コマ数)が登録されていません。" };
  }
  if (timeSlots.length === 0) {
    return { success: false, reason: "コマ(時限)が登録されていません。" };
  }
  if (rooms.length === 0) {
    return { success: false, reason: "教室が登録されていません。" };
  }

  const lessons: Lesson[] = requirements.flatMap((req) =>
    Array.from({ length: req.periodsPerWeek }, () => ({
      classGroupId: req.classGroupId,
      subjectId: req.subjectId,
      teacherId: req.teacherId,
      preferredRoomId: req.preferredRoomId,
    }))
  );

  const teacherBlockedSlots = new Set(
    unavailability.map((u) => `${u.teacherId}-${u.dayOfWeek}-${u.periodNumber}`)
  );
  const teacherBlockedCount = new Map<string, number>();
  for (const u of unavailability) {
    teacherBlockedCount.set(u.teacherId, (teacherBlockedCount.get(u.teacherId) ?? 0) + 1);
  }

  const feasibilityError = checkFeasibility(lessons, timeSlots, teacherBlockedCount);
  if (feasibilityError) {
    return { success: false, reason: feasibilityError };
  }

  const slotByDayPeriod = new Map(timeSlots.map((s) => [`${s.dayOfWeek}-${s.periodNumber}`, s]));
  const days = DAY_ORDER.filter((d) => timeSlots.some((s) => s.dayOfWeek === d));
  const periodsByDay = new Map<DayOfWeek, number[]>(
    days.map((d) => [
      d,
      timeSlots
        .filter((s) => s.dayOfWeek === d)
        .map((s) => s.periodNumber)
        .sort((a, b) => a - b),
    ])
  );

  // Most-constrained-first is a good default lesson order, but on a large
  // interlocking curriculum a single ordering can hit an unlucky dead end
  // well within budget. Retry a few times with the tie-breaks reshuffled
  // (the primary teacher-constrained-first key is kept via a stable sort)
  // before concluding a pass is genuinely infeasible.
  function attemptPass(maxPeriodsPerDay: number): Placement[] | null {
    for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_PASS; attempt++) {
      const shuffled = shuffle([...lessons]);
      const orderedLessons = shuffled
        .map((lesson, i) => ({ lesson, i }))
        .sort((a, b) => {
          const diff =
            (teacherBlockedCount.get(b.lesson.teacherId) ?? 0) -
            (teacherBlockedCount.get(a.lesson.teacherId) ?? 0);
          return diff !== 0 ? diff : a.i - b.i;
        })
        .map((x) => x.lesson);

      const result = solve(
        orderedLessons,
        rooms,
        teacherBlockedSlots,
        slotByDayPeriod,
        days,
        periodsByDay,
        maxPeriodsPerDay
      );
      if (result) return result;
    }
    return null;
  }

  let assignment = attemptPass(MAX_PERIODS_PER_DAY);
  let relaxedDailyCap = false;
  if (!assignment) {
    assignment = attemptPass(Infinity);
    relaxedDailyCap = assignment !== null;
  }

  if (!assignment) {
    return {
      success: false,
      reason:
        "制約を満たす時間割を作成できませんでした。教員の空きコマ・教室数・週コマ数の設定を見直してください。",
    };
  }

  await prisma.$transaction([
    prisma.timetableEntry.deleteMany({ where: { organizationId } }),
    prisma.timetableEntry.createMany({
      data: assignment.map((a) => ({
        organizationId,
        classGroupId: a.lesson.classGroupId,
        subjectId: a.lesson.subjectId,
        teacherId: a.lesson.teacherId,
        roomId: a.roomId,
        timeSlotId: a.slotId,
      })),
    }),
  ]);

  return { success: true, placedCount: assignment.length, relaxedDailyCap };
}

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

type DayBlock = { min: number; max: number; count: number };
type Candidate = { day: DayOfWeek; period: number; slot: TimeSlot };

function solve(
  orderedLessons: Lesson[],
  rooms: Room[],
  teacherBlockedSlots: Set<string>,
  slotByDayPeriod: Map<string, TimeSlot>,
  days: DayOfWeek[],
  periodsByDay: Map<DayOfWeek, number[]>,
  maxPeriodsPerDay: number
): Placement[] | null {
  const dayIndex = new Map(DAY_ORDER.map((d, i) => [d, i]));

  const teacherSlotUsed = new Set<string>();
  const roomSlotUsed = new Set<string>();
  const classDaySubjectUsed = new Set<string>();
  // The contiguous run of periods class C already has on day D — a new
  // period may only extend this run at either end, which is what keeps the
  // day gap-free regardless of which period the run started at.
  const classDayBlock = new Map<string, DayBlock>();
  const assignment: Placement[] = new Array(orderedLessons.length);

  let steps = 0;

  function periodsToTry(classGroupId: string, day: DayOfWeek): number[] {
    const block = classDayBlock.get(`${classGroupId}-${day}`);
    if (!block) {
      return maxPeriodsPerDay >= 1 ? (periodsByDay.get(day) ?? []) : [];
    }
    if (block.count >= maxPeriodsPerDay) return [];
    const options: number[] = [];
    if (block.min - 1 >= 1) options.push(block.min - 1);
    options.push(block.max + 1);
    return options;
  }

  function backtrack(index: number): boolean {
    if (index === orderedLessons.length) return true;
    if (++steps > MAX_BACKTRACK_STEPS) return false;

    const lesson = orderedLessons[index];

    const candidates: Candidate[] = [];
    for (const day of days) {
      for (const period of periodsToTry(lesson.classGroupId, day)) {
        const slot = slotByDayPeriod.get(`${day}-${period}`);
        if (!slot) continue;
        if (teacherBlockedSlots.has(`${lesson.teacherId}-${day}-${period}`)) continue;
        if (teacherSlotUsed.has(`${lesson.teacherId}-${slot.id}`)) continue;
        candidates.push({ day, period, slot });
      }
    }

    candidates.sort((a, b) => {
      // Prefer days that don't already have this subject for this class,
      // so lessons spread across the week instead of stacking on one day.
      const aRepeats = classDaySubjectUsed.has(`${lesson.classGroupId}-${a.day}-${lesson.subjectId}`) ? 1 : 0;
      const bRepeats = classDaySubjectUsed.has(`${lesson.classGroupId}-${b.day}-${lesson.subjectId}`) ? 1 : 0;
      if (aRepeats !== bRepeats) return aRepeats - bRepeats;
      // Prefer the emptier day, which naturally spreads periods evenly
      // across the week and helps stay under the daily cap.
      const aFilled = classDayBlock.get(`${lesson.classGroupId}-${a.day}`)?.count ?? 0;
      const bFilled = classDayBlock.get(`${lesson.classGroupId}-${b.day}`)?.count ?? 0;
      if (aFilled !== bFilled) return aFilled - bFilled;
      const dayDiff = (dayIndex.get(a.day) ?? 0) - (dayIndex.get(b.day) ?? 0);
      if (dayDiff !== 0) return dayDiff;
      // Tiebreak: prefer starting/extending toward the earlier period.
      return a.period - b.period;
    });

    const roomCandidates: Room[] = lesson.preferredRoomId
      ? [
          ...rooms.filter((r) => r.id === lesson.preferredRoomId),
          ...rooms.filter((r) => r.id !== lesson.preferredRoomId),
        ]
      : rooms;

    for (const candidate of candidates) {
      const { day, period, slot } = candidate;
      for (const room of roomCandidates) {
        const roomKey = `${room.id}-${slot.id}`;
        if (roomSlotUsed.has(roomKey)) continue;

        const teacherKey = `${lesson.teacherId}-${slot.id}`;
        const daySubjKey = `${lesson.classGroupId}-${day}-${lesson.subjectId}`;
        const daySubjAlreadyUsed = classDaySubjectUsed.has(daySubjKey);
        const blockKey = `${lesson.classGroupId}-${day}`;
        const prevBlock = classDayBlock.get(blockKey);
        const newBlock: DayBlock = prevBlock
          ? { min: Math.min(prevBlock.min, period), max: Math.max(prevBlock.max, period), count: prevBlock.count + 1 }
          : { min: period, max: period, count: 1 };

        teacherSlotUsed.add(teacherKey);
        roomSlotUsed.add(roomKey);
        classDaySubjectUsed.add(daySubjKey);
        classDayBlock.set(blockKey, newBlock);
        assignment[index] = { lesson, slotId: slot.id, roomId: room.id };

        if (backtrack(index + 1)) return true;

        teacherSlotUsed.delete(teacherKey);
        roomSlotUsed.delete(roomKey);
        if (!daySubjAlreadyUsed) classDaySubjectUsed.delete(daySubjKey);
        if (prevBlock) classDayBlock.set(blockKey, prevBlock);
        else classDayBlock.delete(blockKey);
      }
    }
    return false;
  }

  return backtrack(0) ? assignment : null;
}

function checkFeasibility(
  lessons: Lesson[],
  timeSlots: TimeSlot[],
  teacherBlockedCount: Map<string, number>
): string | null {
  const totalSlots = timeSlots.length;
  const perClass = new Map<string, number>();
  const perTeacher = new Map<string, number>();

  for (const l of lessons) {
    perClass.set(l.classGroupId, (perClass.get(l.classGroupId) ?? 0) + 1);
    perTeacher.set(l.teacherId, (perTeacher.get(l.teacherId) ?? 0) + 1);
  }

  for (const count of perClass.values()) {
    if (count > totalSlots) {
      return `あるクラスの週の合計コマ数(${count})が、登録されているコマ数(${totalSlots})を超えています。`;
    }
  }
  for (const [teacherId, count] of perTeacher) {
    const free = totalSlots - (teacherBlockedCount.get(teacherId) ?? 0);
    if (count > free) {
      return `ある教員の週の合計担当コマ数(${count})が、その教員の空きコマ数(${free})を超えています。`;
    }
  }
  return null;
}
