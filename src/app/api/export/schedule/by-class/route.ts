import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getDefaultOrganization } from "@/lib/org";
import { toCsv, csvDownloadHeaders } from "@/lib/csv";
import { DAY_LABELS, DAY_ORDER } from "@/lib/days";

export async function GET() {
  const org = await getDefaultOrganization();

  const entries = await prisma.timetableEntry.findMany({
    where: { organizationId: org.id },
    include: { classGroup: true, subject: true, teacher: true, room: true, timeSlot: true },
  });

  entries.sort((a, b) => {
    const classDiff = a.classGroup.name.localeCompare(b.classGroup.name, "ja");
    if (classDiff !== 0) return classDiff;
    const dayDiff =
      DAY_ORDER.indexOf(a.timeSlot.dayOfWeek) - DAY_ORDER.indexOf(b.timeSlot.dayOfWeek);
    return dayDiff !== 0 ? dayDiff : a.timeSlot.periodNumber - b.timeSlot.periodNumber;
  });

  const rows = [
    ["クラス", "曜日", "時限", "科目", "教員", "教室"],
    ...entries.map((e) => [
      e.classGroup.name,
      DAY_LABELS[e.timeSlot.dayOfWeek],
      String(e.timeSlot.periodNumber),
      e.subject.name,
      e.teacher.name,
      e.room.name,
    ]),
  ];

  return new NextResponse(toCsv(rows), {
    headers: csvDownloadHeaders("クラス別時間割.csv"),
  });
}
