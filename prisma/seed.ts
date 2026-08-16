import { PrismaClient, DayOfWeek } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const org = await prisma.organization.upsert({
    where: { slug: "demo-school" },
    update: {},
    create: { name: "デモ学園", slug: "demo-school" },
  });

  const [classA, classB] = await Promise.all([
    prisma.classGroup.upsert({
      where: { organizationId_name: { organizationId: org.id, name: "1年A組" } },
      update: {},
      create: { organizationId: org.id, name: "1年A組", grade: "1年" },
    }),
    prisma.classGroup.upsert({
      where: { organizationId_name: { organizationId: org.id, name: "1年B組" } },
      update: {},
      create: { organizationId: org.id, name: "1年B組", grade: "1年" },
    }),
  ]);

  const subjectNames = ["国語", "数学", "英語", "理科", "社会"];
  const subjects = await Promise.all(
    subjectNames.map((name) =>
      prisma.subject.upsert({
        where: { organizationId_name: { organizationId: org.id, name } },
        update: {},
        create: { organizationId: org.id, name },
      })
    )
  );

  const teacherNames = ["山田先生", "佐藤先生", "鈴木先生", "田中先生", "高橋先生"];
  const teachers = await Promise.all(
    teacherNames.map((name) =>
      prisma.teacher.upsert({
        where: { organizationId_name: { organizationId: org.id, name } },
        update: {},
        create: { organizationId: org.id, name },
      })
    )
  );

  const roomNames = ["101教室", "102教室", "理科室"];
  const rooms = await Promise.all(
    roomNames.map((name) =>
      prisma.room.upsert({
        where: { organizationId_name: { organizationId: org.id, name } },
        update: {},
        create: { organizationId: org.id, name },
      })
    )
  );

  const days: DayOfWeek[] = ["MON", "TUE", "WED", "THU", "FRI"];
  const periods = [
    { periodNumber: 1, startTime: "09:00", endTime: "09:50" },
    { periodNumber: 2, startTime: "10:00", endTime: "10:50" },
    { periodNumber: 3, startTime: "11:00", endTime: "11:50" },
    { periodNumber: 4, startTime: "13:00", endTime: "13:50" },
  ];

  const timeSlots = [];
  for (const day of days) {
    for (const p of periods) {
      const slot = await prisma.timeSlot.upsert({
        where: {
          organizationId_dayOfWeek_periodNumber: {
            organizationId: org.id,
            dayOfWeek: day,
            periodNumber: p.periodNumber,
          },
        },
        update: {},
        create: { organizationId: org.id, dayOfWeek: day, ...p },
      });
      timeSlots.push(slot);
    }
  }

  // A few sample assignments for class A, Monday.
  const mon1 = timeSlots.find((s) => s.dayOfWeek === "MON" && s.periodNumber === 1)!;
  const mon2 = timeSlots.find((s) => s.dayOfWeek === "MON" && s.periodNumber === 2)!;

  await prisma.timetableEntry.upsert({
    where: { classGroupId_timeSlotId: { classGroupId: classA.id, timeSlotId: mon1.id } },
    update: {},
    create: {
      organizationId: org.id,
      classGroupId: classA.id,
      subjectId: subjects[0].id,
      teacherId: teachers[0].id,
      roomId: rooms[0].id,
      timeSlotId: mon1.id,
    },
  });

  await prisma.timetableEntry.upsert({
    where: { classGroupId_timeSlotId: { classGroupId: classA.id, timeSlotId: mon2.id } },
    update: {},
    create: {
      organizationId: org.id,
      classGroupId: classA.id,
      subjectId: subjects[1].id,
      teacherId: teachers[1].id,
      roomId: rooms[1].id,
      timeSlotId: mon2.id,
    },
  });

  const subjectByName = Object.fromEntries(subjects.map((s) => [s.name, s]));
  const teacherByName = Object.fromEntries(teachers.map((t) => [t.name, t]));
  const roomByName = Object.fromEntries(rooms.map((r) => [r.name, r]));

  // Curriculum: which teacher teaches which subject, how many periods/week,
  // for each class. Same shape for both classes here, but teachers are
  // shared across classes so the auto-scheduler must avoid double-booking them.
  const curriculum: {
    subject: string;
    teacher: string;
    periodsPerWeek: number;
    preferredRoom?: string;
  }[] = [
    { subject: "国語", teacher: "山田先生", periodsPerWeek: 4 },
    { subject: "数学", teacher: "佐藤先生", periodsPerWeek: 4 },
    { subject: "英語", teacher: "鈴木先生", periodsPerWeek: 4 },
    { subject: "理科", teacher: "田中先生", periodsPerWeek: 3, preferredRoom: "理科室" },
    { subject: "社会", teacher: "高橋先生", periodsPerWeek: 3 },
  ];

  for (const classGroup of [classA, classB]) {
    for (const c of curriculum) {
      await prisma.curriculumRequirement.upsert({
        where: {
          classGroupId_subjectId: { classGroupId: classGroup.id, subjectId: subjectByName[c.subject].id },
        },
        update: {
          teacherId: teacherByName[c.teacher].id,
          periodsPerWeek: c.periodsPerWeek,
          preferredRoomId: c.preferredRoom ? roomByName[c.preferredRoom].id : null,
        },
        create: {
          organizationId: org.id,
          classGroupId: classGroup.id,
          subjectId: subjectByName[c.subject].id,
          teacherId: teacherByName[c.teacher].id,
          periodsPerWeek: c.periodsPerWeek,
          preferredRoomId: c.preferredRoom ? roomByName[c.preferredRoom].id : null,
        },
      });
    }
  }

  // 高橋先生 (社会) is unavailable all day Friday, to demonstrate the
  // auto-scheduler respecting teacher constraints.
  const takahashi = teacherByName["高橋先生"];
  for (const p of periods) {
    await prisma.teacherUnavailability.upsert({
      where: {
        teacherId_dayOfWeek_periodNumber: {
          teacherId: takahashi.id,
          dayOfWeek: "FRI",
          periodNumber: p.periodNumber,
        },
      },
      update: {},
      create: {
        organizationId: org.id,
        teacherId: takahashi.id,
        dayOfWeek: "FRI",
        periodNumber: p.periodNumber,
      },
    });
  }

  console.log(`Seeded organization "${org.name}" with class groups: ${classA.name}, ${classB.name}`);
  console.log("Seeded curriculum requirements and sample teacher unavailability (高橋先生, Friday).");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
