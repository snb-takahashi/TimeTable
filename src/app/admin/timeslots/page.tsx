import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getDefaultOrganization } from "@/lib/org";
import { readCsvFile } from "@/lib/csv";
import { isForeignKeyError } from "@/lib/prismaErrors";
import { CsvUploadForm } from "@/components/admin/CsvUploadForm";
import type { DayOfWeek } from "@prisma/client";
import { DAY_LABELS, DAY_ORDER, parseDayOfWeek } from "@/lib/days";

async function createTimeSlot(formData: FormData) {
  "use server";
  const dayOfWeek = String(formData.get("dayOfWeek") ?? "") as DayOfWeek;
  const periodNumber = Number(formData.get("periodNumber"));
  if (!dayOfWeek || !periodNumber) return;

  const org = await getDefaultOrganization();
  await prisma.timeSlot.create({
    data: { dayOfWeek, periodNumber, organizationId: org.id },
  });
  revalidatePath("/admin/timeslots");
}

async function deleteTimeSlot(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  try {
    await prisma.timeSlot.delete({ where: { id } });
  } catch (e) {
    if (isForeignKeyError(e)) {
      redirect(
        `/admin/timeslots?error=${encodeURIComponent(
          "このコマは時間割で使用されているため削除できません。先に時間割からこのコマの割当を削除してください。"
        )}`
      );
    }
    throw e;
  }
  revalidatePath("/admin/timeslots");
}

async function importTimeSlotsCsv(formData: FormData) {
  "use server";
  const rows = await readCsvFile(formData.get("file"));
  const org = await getDefaultOrganization();

  let count = 0;
  const errors: string[] = [];

  for (const [i, row] of rows.entries()) {
    const dayOfWeek = parseDayOfWeek(row["曜日"] ?? "");
    const periodNumber = Number(row["時限"]);
    if (!dayOfWeek || !periodNumber) {
      errors.push(`${i + 2}行目: 曜日または時限が不正です`);
      continue;
    }
    await prisma.timeSlot.upsert({
      where: {
        organizationId_dayOfWeek_periodNumber: { organizationId: org.id, dayOfWeek, periodNumber },
      },
      update: {},
      create: { organizationId: org.id, dayOfWeek, periodNumber },
    });
    count++;
  }

  revalidatePath("/admin/timeslots");
  const message =
    `${count}件のコマを取り込みました。` +
    (errors.length > 0 ? ` (エラー${errors.length}件: ${errors.slice(0, 5).join(" / ")})` : "");
  redirect(
    `/admin/timeslots?${errors.length > 0 ? "error" : "notice"}=${encodeURIComponent(message)}`
  );
}

export default async function TimeSlotsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; error?: string }>;
}) {
  const { notice, error } = await searchParams;
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

      {error && (
        <p className="mb-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {notice && (
        <p className="mb-4 rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-700">
          {notice}
        </p>
      )}

      <CsvUploadForm action={importTimeSlotsCsv} columnsHint="曜日,時限" />

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
              {DAY_LABELS[slot.dayOfWeek]}曜 {slot.periodNumber}限
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
