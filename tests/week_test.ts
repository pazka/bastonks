import { assertEquals } from "@std/assert";
import { dateFits, nameSaysDone, parseNameDate, resolveWeek, seasonOf, weekOf } from "../src/server/week.ts";

const D = (s: string) => new Date(`${s}T12:00:00Z`);
const ymd = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;
const cards = (created: string, activity: string, n = 5) =>
  Array.from({ length: n }, () => ({ created: D(created), lastActivity: D(activity) }));

Deno.test("parseNameDate: hand-typed list names from the board", () => {
  const cases: [string, string | null][] = [
    ["DONE 25/11/2024", "2024-11-25"],
    ["DONE 20/11/023", "2023-11-20"],
    ["19/02/24", "2024-02-19"],
    ["DONE 18/08//2025", "2025-08-18"],
    ["DONE 6/10/2025", "2025-10-06"],
    ["3/11/2025", "2025-11-03"],
    ["DONE 13/05/2023", "2023-05-13"],
    ["25/11/2024", "2024-11-25"],
    ["DONE 01.02.2024", "2024-02-01"],
    ["DONE", null],
    ["Backlog", null],
    ["DONE 31/02/2024", null],
    ["En cours", null],
  ];
  for (const [name, want] of cases) assertEquals(ymd(parseNameDate(name)), want, name);
});

Deno.test("nameSaysDone: DONE or a date", () => {
  assertEquals(nameSaysDone("DONE 25/11/2024"), true);
  assertEquals(nameSaysDone("19/02/24"), true);
  assertEquals(nameSaysDone("done semaine"), true);
  assertEquals(nameSaysDone("To do"), false);
  assertEquals(nameSaysDone("En cours"), false);
});

Deno.test("weekOf: Monday of the ISO week", () => {
  assertEquals(weekOf(D("2024-11-29")), "2024-11-25"); // Friday
  assertEquals(weekOf(D("2024-11-25")), "2024-11-25"); // Monday
  assertEquals(weekOf(D("2024-12-01")), "2024-11-25"); // Sunday
  assertEquals(weekOf(D("2025-01-01")), "2024-12-30");
});

Deno.test("seasonOf", () => {
  assertEquals(seasonOf("2024-04-01"), "spring");
  assertEquals(seasonOf("2024-07-01"), "summer");
  assertEquals(seasonOf("2024-10-14"), "autumn");
  assertEquals(seasonOf("2024-12-30"), "winter");
  assertEquals(seasonOf("2025-02-24"), "winter");
});

Deno.test("resolveWeek: the name's date when it fits the cards", () => {
  assertEquals(resolveWeek("DONE 25/11/2024", cards("2024-11-12", "2024-11-26")), {
    week: "2024-11-25",
    from: "name",
  });
  assertEquals(resolveWeek("DONE 20/11/023", cards("2023-11-08", "2023-11-24")).week, "2023-11-20");
  assertEquals(resolveWeek("DONE 18/08//2025", cards("2025-08-04", "2025-08-19")).week, "2025-08-18");
  assertEquals(resolveWeek("19/02/24", cards("2024-02-05", "2024-02-23")).week, "2024-02-19");
});

Deno.test("resolveWeek: a wrong year is repaired from the cards (DONE 13/05/2023 holding May 2024)", () => {
  const r = resolveWeek("DONE 13/05/2023", cards("2024-05-02", "2024-05-17"));
  assertEquals(r.week, "2024-05-13");
});

Deno.test("resolveWeek: no date, or a date that cannot fit → from the cards", () => {
  assertEquals(resolveWeek("Vieux trucs", cards("2023-02-01", "2023-04-05")), {
    week: "2023-04-03",
    from: "cards",
  });
  // 01/01/2020 fits no card year
  assertEquals(resolveWeek("DONE 01/01/2020", cards("2024-03-01", "2024-03-14")).from, "cards");
});

Deno.test("dateFits: tolerances", () => {
  const c = cards("2024-05-01", "2024-05-10");
  assertEquals(dateFits(D("2024-05-10"), c), true);
  assertEquals(dateFits(D("2024-04-25"), c), true); // 6 days before creation
  assertEquals(dateFits(D("2024-04-20"), c), false);
  assertEquals(dateFits(D("2024-06-20"), c), true); // < 45 days after
  assertEquals(dateFits(D("2024-07-30"), c), false);
});
