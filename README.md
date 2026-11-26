# Many Produce

A free desktop app for independent producers, self-producing artists and small companies to run a production in one place: the people, the spaces, the money.

It's the third sibling after Many Write (the writing) and Many Apply (the grants), with the same markdown-folder approach.

- **$0 to build, $0 to use.** No servers, accounts or cloud costs.
- **Local-first.** Everything lives in a folder on your computer (the "vault") as plain markdown and CSV files you own. Edit them in Obsidian or a text editor if you like.
- **No AI features.** Everything is manual, plus simple math. The code was written with Claude Code and OpenHands.
- **Works offline.**
- **Not accounting software and not tax advice.** It keeps tidy records you can hand to a fiscal sponsor, funder or accountant.

## What works in this build

This build covers phases 1 to 3 of the spec, plus the basics of Collaborators and Venues from phase 4.

| Screen | What it does |
| --- | --- |
| **Project switcher** | All projects · each project · Company overhead · New project. Filters every screen and is remembered. |
| **Dashboard** | Cash on hand, still to pay, income raised vs. goal, overdue payments and missing W-9s. A 6/12/26-week **cash flow forecast** with money in/out bars, a running balance line and a "Confirmed only" vs. "Including likely" toggle. **Low-point warnings** (e.g. "Fractured Atlas fund −$420. Venue deposit is due before the crowdfunding payout"), with quick fixes: move a due date or expect income sooner. Lists unscheduled budget lines, with one click to schedule each. Also shows needs attention, this week and a budget snapshot. CSV export. |
| **Bookkeeping** | **+ Income / + Expense** inline form, categories, tags, money sources, receipts, and **splits across projects** by percentage. **Automatic fiscal-sponsor fees** (e.g. Fractured Atlas 8%) that stay in step when you edit or delete the income. Shows a gentle note when ticket sales are routed through a sponsor. Filters, CSV export, and delete with undo. |
| **Budget** | Expense lines with paid-to-date pulled from the ledger by category. Income sources with raised vs. goal **net of the sponsor fee**, expected date and confidence. Inline editing. Import/export in **Many Apply's budget CSV format**. |
| **Payments** | Grouped as Overdue · Next 30 days · Later · Paid. **Ticking one paid creates the ledger entry** with project and category filled in; unticking removes it. Supports splits and `.ics` calendar export. |
| **Collaborators** | Table with role filters. The drawer shows roles, contact details, rate, W-9 status, **paid to date** from the ledger, projects, and a "Schedule payment" button. |
| **Venues** | Card grid with status counts. The drawer shows the deposit schedule, linked from Payments. |
| **Settings** | Vault, theme (Light, Dark, Pink or follow system), currency, money sources with opening balances, low-balance cushion, fiscal sponsors and fee rates, categories and tags. |

Also included: the Cmd/Ctrl+K command palette (jumps to any screen, project, person, venue, entry or payment), Cmd/Ctrl+N for a new item, Cmd/Ctrl+\ to toggle the sidebar and Cmd/Ctrl+. to close the drawer. Changes save automatically, deletes can be undone, and nothing is hard-deleted: deleted files go to `.manyproduce/trash/`. The desktop app reloads the vault when its window regains focus, so edits made in other apps show up.

The other screens in the sidebar (Shopping list, Paperwork, Schedule, Timeline, Stripboard, Clearances, Who has what, Campaigns, Templates and Reports) are marked **soon**. Each one shows what it will do.

## Roadmap (build phases from the spec)

1. ✅ Vault and file formats, projects and the project switcher, Bookkeeping ledger with + Income / + Expense and tags
2. ✅ Budget and Payments (tick paid → ledger), automatic sponsor fees, splits
3. ✅ Dashboard with the cash flow forecast
4. ◐ Collaborators and Venues with drawers ✅ · Paperwork and tax documents
5. Schedule builder and Timeline
6. Shopping list with buyer tags and reimbursements, and Who has what
7. Campaigns and Templates
8. Report builder, house reports, venue settlement, daily reports and PDF export
9. Stripboard (breakdown, board, day out of days) and Clearances
10. Todoist sync, CSV import/export, backup, packaging, GitHub Releases (the release workflow is already in `.github/workflows/release.yml`)

Not built yet: the theme builder, the shared theme folder, and live folder watching (the app reloads on window focus instead).

## Running it

You need Node 20+ and, for the desktop app, Rust plus the [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/).

```bash
npm install
```

Desktop app (opens a real folder on disk):

```bash
npm run tauri dev
```

Browser demo (no Rust needed; data stays in the browser's storage):

```bash
npm run dev
```

Tests and type checks:

```bash
npm test && npm run typecheck
```

Build installers for your platform:

```bash
npm run tauri build
```

Push a `v*` tag to build unsigned Mac, Windows and Linux installers on GitHub Actions. They're attached to a draft release.

### Installing an unsigned build

- **Mac:** right-click the app, choose **Open**, then confirm. You only need to do this the first time.
- **Windows:** if SmartScreen appears, click **More info**, then **Run anyway**.
- **Linux:** use the `.AppImage` (mark it executable) or the `.deb`.

## How it's built

- **Tauri 2** desktop shell. The Rust side (`src-tauri/src/lib.rs`) only exposes a few file commands, scoped to the vault folder you picked.
- **React + TypeScript + Vite** front end. Charts use Recharts. Inter and Space Grotesk fonts are bundled, so everything works offline.
- All the money logic is plain TypeScript in `src/lib/`, with unit tests in `src/lib/lib.test.ts`.
- `src/vault/` reads and writes the vault. `docs/FILE-FORMATS.md` describes every file.

```
src/
  lib/        types, ledger + sponsor fees, budget, payments, forecast, CSV/frontmatter
  vault/      file access (desktop + browser), load/save, sample data
  state/      app state and every save action
  screens/    Dashboard, Bookkeeping, Budget, Payments, Collaborators/Venues, Settings
  ui/         sidebar, header, command palette, drawer, shared bits
src-tauri/    Rust shell
```

## License

MIT
