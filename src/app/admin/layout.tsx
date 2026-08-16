import Link from "next/link";

const NAV = [
  { href: "/admin/timetable", label: "時間割" },
  { href: "/admin/classes", label: "クラス" },
  { href: "/admin/subjects", label: "科目" },
  { href: "/admin/teachers", label: "教員" },
  { href: "/admin/rooms", label: "教室" },
  { href: "/admin/timeslots", label: "コマ" },
  { href: "/admin/curriculum", label: "カリキュラム" },
  { href: "/admin/teacher-availability", label: "教員の不可時間" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex">
      <nav className="w-48 shrink-0 border-r border-gray-200 p-4">
        <p className="font-semibold mb-4">時間割管理</p>
        <ul className="space-y-1">
          {NAV.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="block px-2 py-1.5 rounded text-sm hover:bg-gray-100"
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
