import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getDefaultOrganization } from "@/lib/org";
import { EntitySelector } from "@/components/admin/EntitySelector";
import type { DayOfWeek } from "@prisma/client";
import { DAY_LABELS, DAY_ORDER } from "@/lib/days";

async function markUnavailable(formData: FormData) {
  "use server";
  const teacherId = String(formData.get("teacherId") ?? "");
  const dayOfWeek = String(formData.get("dayOfWeek") ?? "") as DayOfWeek;
  const periodNumber = Number(formData.get("periodNumber"));
  if (!teacherId || !dayOfWeek || !periodNumber) return;

  const org = await getDefaultOrganization();
  await prisma.teacherUnavailability.upsert({
    where: { teacherId_dayOfWeek_periodNumber: { teacherId, dayOfWeek, periodNumber } },
    update: {},
    create: { organizationId: org.id, teacherId, dayOfWeek, periodNumber },
  });
  revalidatePath("/admin/teacher-availability");
  redirect(`/admin/teacher-availability?teacherId=${teacherId}`);
}

async function markAvailable(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  const teacherId = String(formData.get("teacherId") ?? "");
  if (!id) return;
  await prisma.teacherUnavailability.delete({ where: { id } });
  revalidatePath("/admin/teacher-availability");
  redirect(`/admin/teacher-availability?teacherId=${teacherId}`);
}

export default async function TeacherAvailabilityPage({
  searchParams,
}: {
  searchParams: Promise<{ teacherId?: string }>;
}) {
  const { teacherId } = await searchParams;
  const org = await getDefaultOrganization();

  const [teachers, timeSlots] = await Promise.all([
    prisma.teacher.findMany({ where: { organizationId: org.id }, orderBy: { name: "asc" } }),
    prisma.timeSlot.findMany({ where: { organizationId: org.id } }),
  ]);

  const selectedTeacherId = teacherId ?? teachers[0]?.id;

  if (!selectedTeacherId) {
    return <p className="text-sm text-gray-600">まず教員を登録してください。</p>;
  }

  const blocks = await prisma.teacherUnavailability.findMany({
    where: { organizationId: org.id, teacherId: selectedTeacherId },
  });
  const blockedByDayPeriod = new Map(
    blocks.map((b) => [`${b.dayOfWeek}-${b.periodNumber}`, b])
  );

  const periods = [...new Set(timeSlots.map((s) => s.periodNumber))].sort((a, b) => a - b);
  const days = DAY_ORDER.filter((d) => timeSlots.some((s) => s.dayOfWeek === d));

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold">教員の授業不可時間</h1>
        <EntitySelector
          items={teachers}
          selectedId={selectedTeacherId}
          basePath="/admin/teacher-availability"
          paramName="teacherId"
        />
      </div>
      <p className="text-sm text-gray-600 mb-4">
        セルをクリックして「不可」に設定すると、自動生成時にこの教員はその時間に割り当てられなくなります。
      </p>

      {timeSlots.length === 0 ? (
        <p className="text-sm text-gray-600">まずコマ(時限)を登録してください。</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="border-collapse">
            <thead>
              <tr>
                <th className="border border-gray-200 px-2 py-1 text-xs bg-gray-50" />
                {days.map((d) => (
                  <th
                    key={d}
                    className="border border-gray-200 px-3 py-1 text-xs bg-gray-50 min-w-[80px]"
                  >
                    {DAY_LABELS[d]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {periods.map((period) => (
                <tr key={period}>
                  <th className="border border-gray-200 px-2 py-1 text-xs bg-gray-50">
                    {period}限
                  </th>
                  {days.map((d) => {
                    const block = blockedByDayPeriod.get(`${d}-${period}`);
                    return (
                      <td key={d} className="border border-gray-200 text-center p-1 text-xs">
                        {block ? (
                          <form action={markAvailable}>
                            <input type="hidden" name="id" value={block.id} />
                            <input type="hidden" name="teacherId" value={selectedTeacherId} />
                            <button
                              type="submit"
                              className="w-full py-1.5 rounded bg-red-100 text-red-700 cursor-pointer"
                            >
                              不可
                            </button>
                          </form>
                        ) : (
                          <form action={markUnavailable}>
                            <input type="hidden" name="teacherId" value={selectedTeacherId} />
                            <input type="hidden" name="dayOfWeek" value={d} />
                            <input type="hidden" name="periodNumber" value={period} />
                            <button
                              type="submit"
                              className="w-full py-1.5 rounded bg-green-50 text-green-700 cursor-pointer hover:bg-green-100"
                            >
                              可
                            </button>
                          </form>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
