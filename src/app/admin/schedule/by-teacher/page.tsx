import { prisma } from "@/lib/db";
import { getDefaultOrganization } from "@/lib/org";
import { ScheduleGridTable } from "@/components/admin/ScheduleGridTable";

export default async function ScheduleByTeacherPage() {
  const org = await getDefaultOrganization();

  const [teachers, timeSlots, entries] = await Promise.all([
    prisma.teacher.findMany({ where: { organizationId: org.id }, orderBy: { name: "asc" } }),
    prisma.timeSlot.findMany({ where: { organizationId: org.id } }),
    prisma.timetableEntry.findMany({
      where: { organizationId: org.id },
      include: { subject: true, classGroup: true, room: true },
    }),
  ]);

  if (teachers.length === 0) {
    return <p className="text-sm text-gray-600">まず教員を登録してください。</p>;
  }
  if (timeSlots.length === 0) {
    return <p className="text-sm text-gray-600">まずコマ(時限)を登録してください。</p>;
  }

  return (
    <section>
      <h1 className="text-xl font-semibold mb-4">教員別時間割</h1>
      {teachers.map((teacher) => {
        const byTimeSlot = new Map(
          entries.filter((e) => e.teacherId === teacher.id).map((e) => [e.timeSlotId, e])
        );
        return (
          <ScheduleGridTable
            key={teacher.id}
            heading={teacher.name}
            timeSlots={timeSlots}
            cellLines={(slotId) => {
              const e = byTimeSlot.get(slotId);
              return e ? [e.subject.name, e.classGroup.name, e.room.name] : null;
            }}
          />
        );
      })}
    </section>
  );
}
