import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getDefaultOrganization } from "@/lib/org";
import { toCsv, csvDownloadHeaders } from "@/lib/csv";
import { DAY_LABELS, DAY_ORDER } from "@/lib/days";

export async function GET(request: Request) {
  const org = await getDefaultOrganization();
  const classId = new URL(request.url).searchParams.get("classId");
  if (!classId) {
    return NextResponse.json({ error: "classId is required" }, { status: 400 });
  }

  const [classGroup, entries] = await Promise.all([
    prisma.classGroup.findFirst({ where: { id: classId, organizationId: org.id } }),
    prisma.timetableEntry.findMany({
      where: { organizationId: org.id, classGroupId: classId },
      include: { subject: true, teacher: true, room: true, timeSlot: true },
    }),
  ]);

  if (!classGroup) {
    return NextResponse.json({ error: "class not found" }, { status: 404 });
  }

  entries.sort((a, b) => {
    const dayDiff =
      DAY_ORDER.indexOf(a.timeSlot.dayOfWeek) - DAY_ORDER.indexOf(b.timeSlot.dayOfWeek);
    return dayDiff !== 0 ? dayDiff : a.timeSlot.periodNumber - b.timeSlot.periodNumber;
  });

  const rows = [
    ["曜日", "時限", "科目", "教員", "教室"],
    ...entries.map((e) => [
      DAY_LABELS[e.timeSlot.dayOfWeek],
      String(e.timeSlot.periodNumber),
      e.subject.name,
      e.teacher.name,
      e.room.name,
    ]),
  ];

  return new NextResponse(toCsv(rows), {
    headers: csvDownloadHeaders(`${classGroup.name}_時間割.csv`),
  });
}
