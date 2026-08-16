import { DAY_LABELS, DAY_ORDER } from "@/lib/days";
import type { DayOfWeek } from "@prisma/client";

type SlotRef = { id: string; dayOfWeek: DayOfWeek; periodNumber: number };

export function ScheduleGridTable({
  heading,
  timeSlots,
  cellLines,
}: {
  heading: string;
  timeSlots: SlotRef[];
  /** Returns the lines to show in a cell for this slot, or null if empty. */
  cellLines: (slotId: string) => string[] | null;
}) {
  const periods = [...new Set(timeSlots.map((s) => s.periodNumber))].sort((a, b) => a - b);
  const days = DAY_ORDER.filter((d) => timeSlots.some((s) => s.dayOfWeek === d));
  const slotByDayPeriod = new Map(timeSlots.map((s) => [`${s.dayOfWeek}-${s.periodNumber}`, s]));

  return (
    <section className="mb-8">
      <h2 className="text-sm font-semibold mb-2">{heading}</h2>
      <div className="overflow-x-auto">
        <table className="border-collapse">
          <thead>
            <tr>
              <th className="border border-gray-200 px-2 py-1 text-xs bg-gray-50" />
              {days.map((d) => (
                <th
                  key={d}
                  className="border border-gray-200 px-3 py-1 text-xs bg-gray-50 min-w-[130px]"
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
                  const slot = slotByDayPeriod.get(`${d}-${period}`);
                  if (!slot) {
                    return <td key={d} className="border border-gray-200 bg-gray-50" />;
                  }
                  const lines = cellLines(slot.id);
                  return (
                    <td key={d} className="border border-gray-200 align-top p-2 text-xs">
                      {lines?.map((line, i) => (
                        <p key={i} className={i === 0 ? "font-medium" : "text-gray-500"}>
                          {line}
                        </p>
                      ))}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
