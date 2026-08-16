import { prisma } from "@/lib/db";

export type ConflictCheckInput = {
  classGroupId: string;
  teacherId: string;
  roomId: string;
  timeSlotId: string;
  /** Exclude this entry id when re-checking during an edit. */
  excludeEntryId?: string;
};

export type ConflictResult =
  | { hasConflict: false }
  | { hasConflict: true; reason: string };

/**
 * Pre-checks for double-booking so the UI can show a friendly message.
 * The DB unique constraints on TimetableEntry remain the source of truth
 * (they also guard against race conditions this check can't catch).
 */
export async function checkConflicts(
  input: ConflictCheckInput
): Promise<ConflictResult> {
  const { classGroupId, teacherId, roomId, timeSlotId, excludeEntryId } = input;

  const [classConflict, teacherConflict, roomConflict] = await Promise.all([
    prisma.timetableEntry.findFirst({
      where: { classGroupId, timeSlotId, id: { not: excludeEntryId } },
      include: { subject: true },
    }),
    prisma.timetableEntry.findFirst({
      where: { teacherId, timeSlotId, id: { not: excludeEntryId } },
      include: { classGroup: true },
    }),
    prisma.timetableEntry.findFirst({
      where: { roomId, timeSlotId, id: { not: excludeEntryId } },
      include: { classGroup: true },
    }),
  ]);

  if (classConflict) {
    return {
      hasConflict: true,
      reason: `このクラスは同じコマに既に「${classConflict.subject.name}」が割り当てられています。`,
    };
  }
  if (teacherConflict) {
    return {
      hasConflict: true,
      reason: `この教員は同じコマに既に「${teacherConflict.classGroup.name}」を担当しています。`,
    };
  }
  if (roomConflict) {
    return {
      hasConflict: true,
      reason: `この教室は同じコマに既に「${roomConflict.classGroup.name}」が使用中です。`,
    };
  }

  return { hasConflict: false };
}
