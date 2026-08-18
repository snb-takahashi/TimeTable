import { prisma } from "@/lib/db";
import { getDefaultOrganization } from "@/lib/org";
import { ScheduleGridTable } from "@/components/admin/ScheduleGridTable";

export default async function ScheduleByClassPage() {
  const org = await getDefaultOrganization();

  const [classGroups, timeSlots, entries] = await Promise.all([
    prisma.classGroup.findMany({ where: { organizationId: org.id }, orderBy: { name: "asc" } }),
    prisma.timeSlot.findMany({ where: { organizationId: org.id } }),
    prisma.timetableEntry.findMany({
      where: { organizationId: org.id },
      include: { subject: true, teacher: true, room: true },
    }),
  ]);

  if (classGroups.length === 0) {
    return <p className="text-sm text-gray-600">まずクラスを登録してください。</p>;
  }
  if (timeSlots.length === 0) {
    return <p className="text-sm text-gray-600">まずコマ(時限)を登録してください。</p>;
  }
  if (entries.length === 0) {
    return (
      <p className="text-sm text-gray-600">
        まだ時間割が作成されていません(「時間割(編集)」から入力するか、自動生成してください)。
      </p>
    );
  }

  return (
    <section>
      <h1 className="text-xl font-semibold mb-4">クラス別時間割</h1>
      {classGroups.map((classGroup) => {
        const byTimeSlot = new Map(
          entries.filter((e) => e.classGroupId === classGroup.id).map((e) => [e.timeSlotId, e])
        );
        return (
          <ScheduleGridTable
            key={classGroup.id}
            heading={classGroup.name}
            timeSlots={timeSlots}
            cellLines={(slotId) => {
              const e = byTimeSlot.get(slotId);
              return e ? [e.subject.name, e.teacher.name, e.room.name] : null;
            }}
          />
        );
      })}
    </section>
  );
}
