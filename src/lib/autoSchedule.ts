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
  | { success: true; placedCount: number; relaxedDailyCap: boolean; relaxedTeacherContiguity: boolean }
  | { success: false; reason: string };

const MAX_BACKTRACK_STEPS = 20_000;
const MAX_PERIODS_PER_DAY = 3;
const MAX_ATTEMPTS_PER_PASS = 6;
// Additional retries (beyond MAX_ATTEMPTS_PER_PASS) spent specifically
// searching for a placement where every strict class's used days all land
// on exactly 2-3 periods, since that isn't something solve() can guarantee
// on its own — it's checked afterwards and retried if violated.
const MAX_STRICT_VALIDATION_ATTEMPTS = 80;
// Classes whose weekly total is within this many periods must land on
// exactly 2 or 3 periods on every day of the week — no exceptions.
const STRICT_CAP_THRESHOLD = 15;
const STRICT_MIN_PER_DAY = 2;

/**
 * Regenerates the entire timetable for an organization from its curriculum
 * requirements (class/subject/teacher/periods-per-week) and constraints
 * (teacher unavailability, room count). Replaces all existing entries.
 *
 * Each class's periods on a given day are always kept contiguous — a period
 * can only be added if it's immediately before or after the periods that
 * class already has that day (e.g. 2,3,4 is fine; 2,4 with a gap at 3 is
 * not), so there's never a free period in the middle of a class's day. The
 * block can start anywhere, not just period 1.
 *
 * Classes whose weekly total is at most STRICT_CAP_THRESHOLD must land on
 * exactly 2 or 3 periods every day of the week (never 0, 1, or 4+) — this
 * is enforced with no relaxation: such a class is always capped at
 * MAX_PERIODS_PER_DAY, and a solution is only accepted once every one of
 * its days actually reaches 2 or 3 (validated after solving, with retries).
 * Classes above the threshold instead get a best-effort
 * MAX_PERIODS_PER_DAY cap that's lifted only if the whole schedule would
 * otherwise be infeasible.
 *
 * Part-time (非常勤) teachers get the same contiguous-day treatment applied
 * to their own schedule, plus a preference for reusing days they're already
 * on campus for, so their week is concentrated into as few days as
 * possible. If satisfying every rule at once is infeasible, generation
 * falls back in stages — first lifting the daily class cap (for non-strict
 * classes only), then (only as a last resort) lifting the part-time
 * contiguity requirement — so a schedule is still produced where possible.
 */
export async function generateSchedule(
  organizationId: string,
  onProgress?: (percent: number) => void
): Promise<GenerateResult> {
  const [requirements, timeSlots, rooms, teachers, unavailability] = await Promise.all([
    prisma.curriculumRequirement.findMany({ where: { organizationId } }),
    prisma.timeSlot.findMany({ where: { organizationId } }),
    prisma.room.findMany({ where: { organizationId } }),
    prisma.teacher.findMany({ where: { organizationId } }),
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

  const partTimeTeacherIds = new Set(teachers.filter((t) => t.isPartTime).map((t) => t.id));

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

  onProgress?.(0);

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

  const classTotals = new Map<string, number>();
  for (const l of lessons) {
    classTotals.set(l.classGroupId, (classTotals.get(l.classGroupId) ?? 0) + 1);
  }
  // Only classes whose total actually fits a 2-3/day pattern across the
  // available days are eligible for strict enforcement — a class with too
  // few periods to reach 2 on every day can't satisfy it no matter what.
  const strictClassIds = new Set(
    [...classTotals.entries()]
      .filter(
        ([, total]) => total <= STRICT_CAP_THRESHOLD && total >= STRICT_MIN_PER_DAY * days.length
      )
      .map(([classGroupId]) => classGroupId)
  );

  function violatesStrictRule(assignment: Placement[]): boolean {
    if (strictClassIds.size === 0) return false;
    const counts = new Map<string, number>();
    const dayBySlotId = new Map<string, DayOfWeek>();
    for (const s of timeSlots) dayBySlotId.set(s.id, s.dayOfWeek);
    for (const p of assignment) {
      if (!strictClassIds.has(p.lesson.classGroupId)) continue;
      const day = dayBySlotId.get(p.slotId)!;
      const key = `${p.lesson.classGroupId}-${day}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const classGroupId of strictClassIds) {
      for (const day of days) {
        const n = counts.get(`${classGroupId}-${day}`) ?? 0;
        if (n < STRICT_MIN_PER_DAY || n > MAX_PERIODS_PER_DAY) return true;
      }
    }
    return false;
  }

  // Most-constrained-first is a good default lesson order, but on a large
  // interlocking curriculum a single ordering can hit an unlucky dead end
  // well within budget. Retry a few times with the tie-breaks reshuffled
  // (the primary teacher-constrained-first key is kept via a stable sort)
  // before concluding a pass is genuinely infeasible. When strict classes
  // are present, keep retrying beyond a bare success until one is found
  // that also satisfies their exact 2-3/day requirement.
  async function attemptPass(
    maxPeriodsPerDay: number,
    enforceTeacherContiguity: boolean
  ): Promise<Placement[] | null> {
    const attempts = strictClassIds.size > 0 ? MAX_STRICT_VALIDATION_ATTEMPTS : MAX_ATTEMPTS_PER_PASS;
    for (let attempt = 0; attempt < attempts; attempt++) {
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

      const result = await solve(
        orderedLessons,
        rooms,
        teacherBlockedSlots,
        slotByDayPeriod,
        days,
        periodsByDay,
        maxPeriodsPerDay,
        partTimeTeacherIds,
        enforceTeacherContiguity,
        strictClassIds
      );

      attemptsDone++;
      onProgress?.(Math.min(99, Math.round((attemptsDone / totalPassBudget) * 100)));
      // Each attempt can itself be CPU-heavy (up to MAX_BACKTRACK_STEPS), so
      // yield to the event loop here — otherwise a concurrent progress-poll
      // request would never get a chance to run until generation finishes.
      await new Promise((resolve) => setImmediate(resolve));

      if (result && !violatesStrictRule(result)) return result;
    }
    return null;
  }

  // Try hardest to keep both rules; relax the class daily cap before ever
  // giving up on part-time teacher contiguity, since that one was asked for
  // unconditionally. The daily cap relaxation only ever affects non-strict
  // classes — strict classes always stay capped at MAX_PERIODS_PER_DAY and
  // are additionally validated to never drop below 2.
  //
  // Enforcing teacher contiguity is only ever different from not enforcing
  // it when a part-time teacher exists — with none, skip straight past
  // those passes instead of burning a full retry budget on a pass that's
  // statistically identical to the next one.
  const hasPartTimeTeachers = partTimeTeacherIds.size > 0;
  // Upper bound on how many solve() attempts generation could spend across
  // every pass that might run, used only to turn attempt count into a
  // rough percentage for progress reporting — actual work is usually far
  // less, since a pass stops as soon as it finds a valid assignment.
  const attemptsPerPass = strictClassIds.size > 0 ? MAX_STRICT_VALIDATION_ATTEMPTS : MAX_ATTEMPTS_PER_PASS;
  const totalPassBudget = attemptsPerPass * (hasPartTimeTeachers ? 4 : 2);
  let attemptsDone = 0;
  let assignment: Placement[] | null = null;
  let relaxedDailyCap = false;
  let relaxedTeacherContiguity = false;

  if (hasPartTimeTeachers) {
    assignment = await attemptPass(MAX_PERIODS_PER_DAY, true);
    if (!assignment) {
      assignment = await attemptPass(Infinity, true);
      if (assignment) relaxedDailyCap = true;
    }
  }
  if (!assignment) {
    assignment = await attemptPass(MAX_PERIODS_PER_DAY, false);
    if (assignment && hasPartTimeTeachers) relaxedTeacherContiguity = true;
  }
  if (!assignment) {
    assignment = await attemptPass(Infinity, false);
    if (assignment) {
      relaxedDailyCap = true;
      if (hasPartTimeTeachers) relaxedTeacherContiguity = true;
    }
  }

  if (!assignment) {
    // Unlike the checkFeasibility() cases above (which are structurally
    // impossible no matter how placements are tried), reaching here only
    // means every random ordering tried within this call's retry budget
    // failed — a different shuffle on a later call can still succeed, so
    // the message says so rather than implying the settings must change.
    return {
      success: false,
      reason:
        strictClassIds.size > 0
          ? "制約を満たす時間割を作成できませんでした。特に週15コマ以内のクラスは1日2〜3コマ厳守のため、教員の空きコマ・教室数・週コマ数の設定を見直してください。なお、設定に問題がない場合でも、組み合わせによっては再度「自動生成」を実行すると成功することがあります。"
          : "制約を満たす時間割を作成できませんでした。教員の空きコマ・教室数・週コマ数の設定を見直してください。なお、設定に問題がない場合でも、組み合わせによっては再度「自動生成」を実行すると成功することがあります。",
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

  onProgress?.(100);
  return { success: true, placedCount: assignment.length, relaxedDailyCap, relaxedTeacherContiguity };
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

/** Periods that may extend an existing contiguous block, or any period in
 * the day if the block hasn't started yet (subject to a count cap). */
function contiguousOptions(
  block: DayBlock | undefined,
  day: DayOfWeek,
  cap: number,
  periodsByDay: Map<DayOfWeek, number[]>
): number[] {
  if (!block) return cap >= 1 ? (periodsByDay.get(day) ?? []) : [];
  if (block.count >= cap) return [];
  const options: number[] = [];
  if (block.min - 1 >= 1) options.push(block.min - 1);
  options.push(block.max + 1);
  return options;
}

// Backtracking steps between one event-loop yield — frequent enough that a
// concurrent progress-poll request can actually get a turn to run (Node is
// single-threaded, so without this a single heavy attempt would otherwise
// starve every other request for its whole duration).
const YIELD_EVERY_STEPS = 200;

async function solve(
  orderedLessons: Lesson[],
  rooms: Room[],
  teacherBlockedSlots: Set<string>,
  slotByDayPeriod: Map<string, TimeSlot>,
  days: DayOfWeek[],
  periodsByDay: Map<DayOfWeek, number[]>,
  maxPeriodsPerDay: number,
  partTimeTeacherIds: Set<string>,
  enforceTeacherContiguity: boolean,
  strictClassIds: Set<string>
): Promise<Placement[] | null> {
  const dayIndex = new Map(DAY_ORDER.map((d, i) => [d, i]));

  const teacherSlotUsed = new Set<string>();
  const roomSlotUsed = new Set<string>();
  const classDaySubjectUsed = new Set<string>();
  // The contiguous run of periods class C already has on day D — a new
  // period may only extend this run at either end, which is what keeps the
  // day gap-free regardless of which period the run started at.
  const classDayBlock = new Map<string, DayBlock>();
  // Same idea, but for a part-time teacher's own day (only enforced as a
  // hard constraint when enforceTeacherContiguity is true).
  const teacherDayBlock = new Map<string, DayBlock>();
  // How many periods a teacher already has on a given day, tracked
  // regardless of contiguity enforcement — used to prefer days a part-time
  // teacher is already on campus for, so their week concentrates into as
  // few days as possible.
  const teacherDayCount = new Map<string, number>();
  const assignment: Placement[] = new Array(orderedLessons.length);

  let steps = 0;

  async function backtrack(index: number): Promise<boolean> {
    if (index === orderedLessons.length) return true;
    if (++steps > MAX_BACKTRACK_STEPS) return false;
    if (steps % YIELD_EVERY_STEPS === 0) {
      await new Promise((resolve) => setImmediate(resolve));
    }

    const lesson = orderedLessons[index];
    const teacherIsPartTime = partTimeTeacherIds.has(lesson.teacherId);
    // Strict classes are always capped at MAX_PERIODS_PER_DAY, regardless
    // of the pass's (possibly relaxed) cap — that relaxation is only ever
    // meant for classes above STRICT_CAP_THRESHOLD.
    const classCap = strictClassIds.has(lesson.classGroupId) ? MAX_PERIODS_PER_DAY : maxPeriodsPerDay;

    const candidates: Candidate[] = [];
    for (const day of days) {
      const classOptions = contiguousOptions(
        classDayBlock.get(`${lesson.classGroupId}-${day}`),
        day,
        classCap,
        periodsByDay
      );
      if (classOptions.length === 0) continue;

      let periods = classOptions;
      if (enforceTeacherContiguity && teacherIsPartTime) {
        const teacherOptions = contiguousOptions(
          teacherDayBlock.get(`${lesson.teacherId}-${day}`),
          day,
          Infinity,
          periodsByDay
        );
        periods = classOptions.filter((p) => teacherOptions.includes(p));
      }

      for (const period of periods) {
        const slot = slotByDayPeriod.get(`${day}-${period}`);
        if (!slot) continue;
        if (teacherBlockedSlots.has(`${lesson.teacherId}-${day}-${period}`)) continue;
        if (teacherSlotUsed.has(`${lesson.teacherId}-${slot.id}`)) continue;
        candidates.push({ day, period, slot });
      }
    }

    candidates.sort((a, b) => {
      // For a part-time teacher, strongly prefer a day they're already
      // scheduled on that week, to minimize how many days they commute in.
      if (teacherIsPartTime) {
        const aUsed = (teacherDayCount.get(`${lesson.teacherId}-${a.day}`) ?? 0) > 0 ? 0 : 1;
        const bUsed = (teacherDayCount.get(`${lesson.teacherId}-${b.day}`) ?? 0) > 0 ? 0 : 1;
        if (aUsed !== bUsed) return aUsed - bUsed;
      }
      // Prefer days that don't already have this subject for this class,
      // so lessons spread across the week instead of stacking on one day.
      const aRepeats = classDaySubjectUsed.has(`${lesson.classGroupId}-${a.day}-${lesson.subjectId}`) ? 1 : 0;
      const bRepeats = classDaySubjectUsed.has(`${lesson.classGroupId}-${b.day}-${lesson.subjectId}`) ? 1 : 0;
      if (aRepeats !== bRepeats) return aRepeats - bRepeats;
      // Prefer the class's least-filled day so far. Applied lesson by
      // lesson, this round-robins periods across every available day
      // instead of packing early days full first — which is what keeps
      // every day touched (no 0-period days) and the week landing on a
      // balanced, similar period count per day instead of a couple of
      // lonely single-period days.
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

        const classBlockKey = `${lesson.classGroupId}-${day}`;
        const prevClassBlock = classDayBlock.get(classBlockKey);
        const newClassBlock: DayBlock = prevClassBlock
          ? {
              min: Math.min(prevClassBlock.min, period),
              max: Math.max(prevClassBlock.max, period),
              count: prevClassBlock.count + 1,
            }
          : { min: period, max: period, count: 1 };

        const teacherBlockKey = `${lesson.teacherId}-${day}`;
        const prevTeacherBlock = teacherDayBlock.get(teacherBlockKey);
        const newTeacherBlock: DayBlock = prevTeacherBlock
          ? {
              min: Math.min(prevTeacherBlock.min, period),
              max: Math.max(prevTeacherBlock.max, period),
              count: prevTeacherBlock.count + 1,
            }
          : { min: period, max: period, count: 1 };
        const prevTeacherDayCount = teacherDayCount.get(teacherBlockKey) ?? 0;

        teacherSlotUsed.add(teacherKey);
        roomSlotUsed.add(roomKey);
        classDaySubjectUsed.add(daySubjKey);
        classDayBlock.set(classBlockKey, newClassBlock);
        teacherDayBlock.set(teacherBlockKey, newTeacherBlock);
        teacherDayCount.set(teacherBlockKey, prevTeacherDayCount + 1);
        assignment[index] = { lesson, slotId: slot.id, roomId: room.id };

        if (await backtrack(index + 1)) return true;

        teacherSlotUsed.delete(teacherKey);
        roomSlotUsed.delete(roomKey);
        if (!daySubjAlreadyUsed) classDaySubjectUsed.delete(daySubjKey);
        if (prevClassBlock) classDayBlock.set(classBlockKey, prevClassBlock);
        else classDayBlock.delete(classBlockKey);
        if (prevTeacherBlock) teacherDayBlock.set(teacherBlockKey, prevTeacherBlock);
        else teacherDayBlock.delete(teacherBlockKey);
        teacherDayCount.set(teacherBlockKey, prevTeacherDayCount);
      }
    }
    return false;
  }

  return (await backtrack(0)) ? assignment : null;
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
