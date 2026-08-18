import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getDefaultOrganization } from "@/lib/org";
import { toCsv, csvDownloadHeaders } from "@/lib/csv";
import { DAY_LABELS, DAY_ORDER } from "@/lib/days";

export async function GET() {
  const org = await getDefaultOrganization();

  const entries = await prisma.timetableEntry.findMany({
    where: { organizationId: org.id },
    include: { room: true, subject: true, classGroup: true, teacher: true, timeSlot: true },
  });

  entries.sort((a, b) => {
    const roomDiff = a.room.name.localeCompare(b.room.name, "ja");
    if (roomDiff !== 0) return roomDiff;
    const dayDiff =
      DAY_ORDER.indexOf(a.timeSlot.dayOfWeek) - DAY_ORDER.indexOf(b.timeSlot.dayOfWeek);
    return dayDiff !== 0 ? dayDiff : a.timeSlot.periodNumber - b.timeSlot.periodNumber;
  });

  const rows = [
    ["教室", "曜日", "時限", "科目", "クラス", "教員"],
    ...entries.map((e) => [
      e.room.name,
      DAY_LABELS[e.timeSlot.dayOfWeek],
      String(e.timeSlot.periodNumber),
      e.subject.name,
      e.classGroup.name,
      e.teacher.name,
    ]),
  ];

  return new NextResponse(toCsv(rows), {
    headers: csvDownloadHeaders("教室別時間割.csv"),
  });
}
