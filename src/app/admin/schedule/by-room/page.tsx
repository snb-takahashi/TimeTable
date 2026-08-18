import { prisma } from "@/lib/db";
import { getDefaultOrganization } from "@/lib/org";
import { ScheduleGridTable } from "@/components/admin/ScheduleGridTable";

export default async function ScheduleByRoomPage() {
  const org = await getDefaultOrganization();

  const [rooms, timeSlots, entries] = await Promise.all([
    prisma.room.findMany({ where: { organizationId: org.id }, orderBy: { name: "asc" } }),
    prisma.timeSlot.findMany({ where: { organizationId: org.id } }),
    prisma.timetableEntry.findMany({
      where: { organizationId: org.id },
      include: { subject: true, classGroup: true, teacher: true },
    }),
  ]);

  if (rooms.length === 0) {
    return <p className="text-sm text-gray-600">まず教室を登録してください。</p>;
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
      <h1 className="text-xl font-semibold mb-4">教室別時間割</h1>
      {rooms.map((room) => {
        const byTimeSlot = new Map(
          entries.filter((e) => e.roomId === room.id).map((e) => [e.timeSlotId, e])
        );
        return (
          <ScheduleGridTable
            key={room.id}
            heading={room.name}
            timeSlots={timeSlots}
            cellLines={(slotId) => {
              const e = byTimeSlot.get(slotId);
              return e ? [e.subject.name, e.classGroup.name, e.teacher.name] : null;
            }}
          />
        );
      })}
    </section>
  );
}
