import type { DayOfWeek } from "@prisma/client";

export const DAY_LABELS: Record<DayOfWeek, string> = {
  MON: "月",
  TUE: "火",
  WED: "水",
  THU: "木",
  FRI: "金",
  SAT: "土",
  SUN: "日",
};

export const DAY_ORDER: DayOfWeek[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

/** Accepts either the enum code (MON, case-insensitive) or the Japanese label (月). */
export function parseDayOfWeek(input: string): DayOfWeek | null {
  const trimmed = input.trim();
  const upper = trimmed.toUpperCase();
  if ((DAY_ORDER as string[]).includes(upper)) return upper as DayOfWeek;
  const match = DAY_ORDER.find((d) => DAY_LABELS[d] === trimmed);
  return match ?? null;
}
