import { prisma } from "@/lib/db";
import { DAY_ORDER } from "@/lib/days";
import type { Room, TimeSlot } from "@prisma/client";

type Lesson = {
  classGroupId: string;
  subjectId: string;
  teacherId: string;
  preferredRoomId: string | null;
};

type Placement = { lesson: Lesson; slotId: string; roomId: string };

export type GenerateResult =
  | { success: true; placedCount: number }
  | { success: false; reason: string };

const MAX_BACKTRACK_STEPS = 300_000;

/**
 * Regenerates the entire timetable for an organization from its curriculum
 * requirements (class/subject/teacher/periods-per-week) and constraints
 * (teacher unavailability, room count). Replaces all existing entries.
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

  // Most-constrained-first: teachers with fewer free slots are placed first,
  // since they're hardest to satisfy and should not be left to the end.
  const orderedLessons = [...lessons].sort(
    (a, b) => (teacherBlockedCount.get(b.teacherId) ?? 0) - (teacherBlockedCount.get(a.teacherId) ?? 0)
  );

  const dayIndex = new Map(DAY_ORDER.map((d, i) => [d, i]));
  const classSlotUsed = new Set<string>();
  const teacherSlotUsed = new Set<string>();
  const roomSlotUsed = new Set<string>();
  const classDaySubjectUsed = new Set<string>();
  const assignment: Placement[] = new Array(orderedLessons.length);

  let steps = 0;

  function backtrack(index: number): boolean {
    if (index === orderedLessons.length) return true;
    if (++steps > MAX_BACKTRACK_STEPS) return false;

    const lesson = orderedLessons[index];

    const candidateSlots = timeSlots
      .filter((slot) => {
        if (teacherBlockedSlots.has(`${lesson.teacherId}-${slot.dayOfWeek}-${slot.periodNumber}`)) return false;
        if (classSlotUsed.has(`${lesson.classGroupId}-${slot.id}`)) return false;
        if (teacherSlotUsed.has(`${lesson.teacherId}-${slot.id}`)) return false;
        return true;
      })
      .sort((a, b) => {
        // Prefer days that don't already have this subject for this class,
        // so lessons spread across the week instead of stacking on one day.
        const aRepeats = classDaySubjectUsed.has(`${lesson.classGroupId}-${a.dayOfWeek}-${lesson.subjectId}`) ? 1 : 0;
        const bRepeats = classDaySubjectUsed.has(`${lesson.classGroupId}-${b.dayOfWeek}-${lesson.subjectId}`) ? 1 : 0;
        if (aRepeats !== bRepeats) return aRepeats - bRepeats;
        const dayDiff = (dayIndex.get(a.dayOfWeek) ?? 0) - (dayIndex.get(b.dayOfWeek) ?? 0);
        return dayDiff !== 0 ? dayDiff : a.periodNumber - b.periodNumber;
      });

    const roomCandidates: Room[] = lesson.preferredRoomId
      ? [
          ...rooms.filter((r) => r.id === lesson.preferredRoomId),
          ...rooms.filter((r) => r.id !== lesson.preferredRoomId),
        ]
      : rooms;

    for (const slot of candidateSlots) {
      for (const room of roomCandidates) {
        const roomKey = `${room.id}-${slot.id}`;
        if (roomSlotUsed.has(roomKey)) continue;

        const classKey = `${lesson.classGroupId}-${slot.id}`;
        const teacherKey = `${lesson.teacherId}-${slot.id}`;
        const daySubjKey = `${lesson.classGroupId}-${slot.dayOfWeek}-${lesson.subjectId}`;
        const daySubjAlreadyUsed = classDaySubjectUsed.has(daySubjKey);

        classSlotUsed.add(classKey);
        teacherSlotUsed.add(teacherKey);
        roomSlotUsed.add(roomKey);
        classDaySubjectUsed.add(daySubjKey);
        assignment[index] = { lesson, slotId: slot.id, roomId: room.id };

        if (backtrack(index + 1)) return true;

        classSlotUsed.delete(classKey);
        teacherSlotUsed.delete(teacherKey);
        roomSlotUsed.delete(roomKey);
        if (!daySubjAlreadyUsed) classDaySubjectUsed.delete(daySubjKey);
      }
    }
    return false;
  }

  const solved = backtrack(0);
  if (!solved) {
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

  return { success: true, placedCount: assignment.length };
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
