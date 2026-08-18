import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getDefaultOrganization } from "@/lib/org";
import { toCsv, csvDownloadHeaders } from "@/lib/csv";
import { DAY_LABELS, DAY_ORDER } from "@/lib/days";

export async function GET() {
  const org = await getDefaultOrganization();

  const entries = await prisma.timetableEntry.findMany({
    where: { organizationId: org.id },
    include: { teacher: true, subject: true, classGroup: true, room: true, timeSlot: true },
  });

  entries.sort((a, b) => {
    const teacherDiff = a.teacher.name.localeCompare(b.teacher.name, "ja");
    if (teacherDiff !== 0) return teacherDiff;
    const dayDiff =
      DAY_ORDER.indexOf(a.timeSlot.dayOfWeek) - DAY_ORDER.indexOf(b.timeSlot.dayOfWeek);
    return dayDiff !== 0 ? dayDiff : a.timeSlot.periodNumber - b.timeSlot.periodNumber;
  });

  const rows = [
    ["教員", "曜日", "時限", "科目", "クラス", "教室"],
    ...entries.map((e) => [
      e.teacher.name,
      DAY_LABELS[e.timeSlot.dayOfWeek],
      String(e.timeSlot.periodNumber),
      e.subject.name,
      e.classGroup.name,
      e.room.name,
    ]),
  ];

  return new NextResponse(toCsv(rows), {
    headers: csvDownloadHeaders("教員別時間割.csv"),
  });
}
