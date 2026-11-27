import { describe, expect, it } from "vitest";
import { MemoryFS } from "../src/lib/fs";
import { filterLinks, groupLinks, hostOf, linksFromCSV, linksToCSV, sortTodos, todosFromCSV, todosToCSV } from "../src/lib/hub";
import { sampleVault } from "../src/lib/seed";
import type { HubLink, HubTodo } from "../src/lib/types";
import { loadVault, saveLinks, saveTodos } from "../src/lib/vault";

const todo = (x: Partial<HubTodo>): HubTodo => ({ id: "t", text: "x", done: false, project: "", due: "", created: "", done_date: "", ...x });
const link = (x: Partial<HubLink>): HubLink => ({ id: "l", title: "", url: "https://example.com", group: "", notes: "", ...x });

describe("quick hub", () => {
  it("loads the sample hub and round-trips through CSV", async () => {
    const v = await loadVault(new MemoryFS(sampleVault("2026-11-26")));
    expect(v.todos.length).toBeGreaterThan(0);
    expect(v.links.length).toBeGreaterThan(0);
    expect(todosFromCSV(todosToCSV(v.todos))).toEqual(v.todos);
    expect(linksFromCSV(linksToCSV(v.links))).toEqual(v.links);
  });

  it("an empty vault has no to-dos or links, and saves create the files", async () => {
    const fs = new MemoryFS();
    const v = await loadVault(fs);
    expect(v.todos).toEqual([]);
    expect(v.links).toEqual([]);
    await saveTodos(fs, [todo({ id: "a", text: "Call the venue, re: load-in", done: true })]);
    await saveLinks(fs, [link({ id: "b", title: "Canva", url: "https://canva.com", group: "Design" })]);
    const v2 = await loadVault(fs);
    expect(v2.todos[0]).toMatchObject({ text: "Call the venue, re: load-in", done: true });
    expect(v2.links[0]).toMatchObject({ title: "Canva", group: "Design" });
  });

  it("finds links by any word", () => {
    const ls = [link({ id: "1", title: "Poster", url: "https://www.canva.com/x", group: "Design" }), link({ id: "2", title: "Donate page", url: "https://gofundme.com", group: "Fundraising" })];
    expect(filterLinks(ls, "canva").map((l) => l.id)).toEqual(["1"]);
    expect(filterLinks(ls, "fund donate").map((l) => l.id)).toEqual(["2"]);
    expect(filterLinks(ls, "  ")).toHaveLength(2);
  });

  it("groups links with ungrouped last, and shows hosts", () => {
    const g = groupLinks([link({ id: "1" }), link({ id: "2", group: "Design" }), link({ id: "3", group: "Design" })]);
    expect(g.map((x) => [x.group, x.links.length])).toEqual([["Design", 2], ["", 1]]);
    expect(hostOf("https://www.canva.com/design/abc")).toBe("canva.com");
    expect(hostOf("mailto:hi@example.com")).toBe("hi@example.com");
  });

  it("sorts open to-dos by due date, then undated, then done", () => {
    const s = sortTodos([
      todo({ id: "done", done: true, done_date: "2026-11-01" }),
      todo({ id: "undated" }),
      todo({ id: "later", due: "2026-12-10" }),
      todo({ id: "soon", due: "2026-11-30" }),
    ]);
    expect(s.map((t) => t.id)).toEqual(["soon", "later", "undated", "done"]);
  });
});
