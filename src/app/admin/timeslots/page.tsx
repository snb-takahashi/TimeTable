import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getDefaultOrganization } from "@/lib/org";
import type { DayOfWeek } from "@prisma/client";
import { DAY_LABELS, DAY_ORDER } from "@/lib/days";

async function createTimeSlot(formData: FormData) {
  "use server";
  const dayOfWeek = String(formData.get("dayOfWeek") ?? "") as DayOfWeek;
  const periodNumber = Number(formData.get("periodNumber"));
  const startTime = String(formData.get("startTime") ?? "").trim();
  const endTime = String(formData.get("endTime") ?? "").trim();
  if (!dayOfWeek || !periodNumber || !startTime || !endTime) return;

  const org = await getDefaultOrganization();
  await prisma.timeSlot.create({
    data: { dayOfWeek, periodNumber, startTime, endTime, organizationId: org.id },
  });
  revalidatePath("/admin/timeslots");
}

async function deleteTimeSlot(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await prisma.timeSlot.delete({ where: { id } });
  revalidatePath("/admin/timeslots");
}

export default async function TimeSlotsPage() {
  const org = await getDefaultOrganization();
  const slots = await prisma.timeSlot.findMany({
    where: { organizationId: org.id },
  });
  slots.sort((a, b) => {
    const d = DAY_ORDER.indexOf(a.dayOfWeek) - DAY_ORDER.indexOf(b.dayOfWeek);
    return d !== 0 ? d : a.periodNumber - b.periodNumber;
  });

  return (
    <section className="max-w-xl">
      <h1 className="text-xl font-semibold mb-4">コマ(時限)</h1>

      <ul className="mb-6 divide-y divide-gray-200 border border-gray-200 rounded">
        {slots.length === 0 && (
          <li className="px-3 py-2 text-sm text-gray-500">まだ登録がありません</li>
        )}
        {slots.map((slot) => (
          <li
            key={slot.id}
            className="flex items-center justify-between px-3 py-2 text-sm"
          >
            <span>
              {DAY_LABELS[slot.dayOfWeek]}曜 {slot.periodNumber}限（
              {slot.startTime}〜{slot.endTime}）
            </span>
            <form action={deleteTimeSlot}>
              <input type="hidden" name="id" value={slot.id} />
              <button
                type="submit"
                className="text-red-600 hover:underline cursor-pointer"
              >
                削除
              </button>
            </form>
          </li>
        ))}
      </ul>

      <form action={createTimeSlot} className="flex gap-2 items-end flex-wrap">
        <div className="flex flex-col">
          <label className="text-xs text-gray-600 mb-1" htmlFor="dayOfWeek">
            曜日
          </label>
          <select
            id="dayOfWeek"
            name="dayOfWeek"
            required
            className="border border-gray-300 rounded px-2 py-1 text-sm"
          >
            {DAY_ORDER.map((d) => (
              <option key={d} value={d}>
                {DAY_LABELS[d]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col">
          <label className="text-xs text-gray-600 mb-1" htmlFor="periodNumber">
            時限
          </label>
          <input
            id="periodNumber"
            name="periodNumber"
            type="number"
            min={1}
            required
            className="border border-gray-300 rounded px-2 py-1 text-sm w-16"
          />
        </div>
        <div className="flex flex-col">
          <label className="text-xs text-gray-600 mb-1" htmlFor="startTime">
            開始
          </label>
          <input
            id="startTime"
            name="startTime"
            type="time"
            required
            className="border border-gray-300 rounded px-2 py-1 text-sm"
          />
        </div>
        <div className="flex flex-col">
          <label className="text-xs text-gray-600 mb-1" htmlFor="endTime">
            終了
          </label>
          <input
            id="endTime"
            name="endTime"
            type="time"
            required
            className="border border-gray-300 rounded px-2 py-1 text-sm"
          />
        </div>
        <button
          type="submit"
          className="bg-black text-white rounded px-3 py-1.5 text-sm cursor-pointer"
        >
          追加
        </button>
      </form>
    </section>
  );
}
