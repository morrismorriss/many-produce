# Many Produce

A free desktop app for independent producers, self-producing artists and small companies to run a production in one place: the people, the spaces, the money.

It's the third sibling after Many Write (the writing) and Many Apply (the grants), with the same markdown-folder approach.

- **$0 to build, $0 to use.** No servers, accounts or cloud costs.
- **Local-first.** Everything lives in a folder on your computer (the "vault") as plain markdown and CSV files you own. Edit them in Obsidian or a text editor if you like.
- **No AI features.** Everything is manual, plus simple math. The code was written with Claude Code and OpenHands.
- **Works offline.**
- **Not accounting software and not tax advice.** It keeps tidy records you can hand to a fiscal sponsor, funder or accountant.

## What works in this build

This build covers phases 1 to 5 of the spec. To keep the sidebar short, related screens are combined as tabs: **Bookkeeping** holds Ledger · Budget · Payments; **Schedule** holds Calendar · Availability · Scenes · Timeline (plus Stripboard for film projects); **Paperwork** holds Documents · Missing · W-9s · 1099s · My tax documents · Clearances; and "Who has what" is now the **Equipment log**.

| Screen | What it does |
| --- | --- |
| **Project switcher** | All projects · each project · Company overhead · New project. Filters every screen and is remembered. |
| **Dashboard** | Cash on hand, still to pay, income raised vs. goal, overdue payments and missing W-9s. A 6/12/26-week **cash flow forecast** with money in/out bars, a running balance line and a "Confirmed only" vs. "Including likely" toggle. **Low-point warnings** (e.g. "Fractured Atlas fund −$420. Venue deposit is due before the crowdfunding payout"), with quick fixes: move a due date or expect income sooner. Lists unscheduled budget lines, with one click to schedule each. Also shows needs attention, this week and a budget snapshot. CSV export. |
| **Bookkeeping → Ledger** | **+ Income / + Expense** inline form, categories, tags, money sources, receipts, and **splits across projects** by percentage. **Automatic fiscal-sponsor fees** (e.g. Fractured Atlas 8%) that stay in step when you edit or delete the income. Shows a gentle note when ticket sales are routed through a sponsor. Filters, CSV export, and delete with undo. |
| **Bookkeeping → Budget** | Expense lines with paid-to-date pulled from the ledger by category. Income sources with raised vs. goal **net of the sponsor fee**, expected date and confidence. Inline editing. Import/export in **Many Apply's budget CSV format**. |
| **Bookkeeping → Payments** | Grouped as Overdue · Next 30 days · Later · Paid. **Ticking one paid creates the ledger entry** with project and category filled in; unticking removes it. Supports splits and `.ics` calendar export. |
| **Schedule** | **Calendar:** rehearsals, read-throughs, fittings, design meetings, tech, dress, performances, shoots and strike, one week at a time. Choosing scenes calls the right people. Warnings appear when someone is called during a conflict, when a space is double-booked across projects, or when someone goes over a weekly hours limit you set. You can print a call sheet or the week's schedule, and export an `.ics` file for everyone or one person's calls only. **Availability:** **import everyone's availability from a CSV**, either a grid with names down the side and dates across (cells like `x`, `busy`, `after 6pm`, `2–5pm`) or one row per conflict. Names are matched to collaborators, new people can be added, re-imports replace older conflicts, and it can be undone. A people × dates grid shows conflicts, best dates for everyone or for one scene's cast (with one click to schedule), and hours called per person, with a one-click payment for hourly rates. You can also print a conflicts form to send round. **Scenes:** paste a scene list to get a scenes × characters grid, plus a cast list that maps characters to people. **Timeline:** a checklist by week or a timeline by department. Tasks can be set relative to key dates ("Opening − 8 weeks") and move when opening moves, with a preview before you save. Milestones from Payments, Paperwork and the Schedule appear automatically. Starter templates: Staged reading, Fringe / bar show, Full production and Closing checklist; save any project's timeline as a template. |
| **Collaborators** | Table with role filters. The drawer shows roles, contact details, rate, W-9 status, **paid to date** from the ledger, projects, and a "Schedule payment" button. |
| **Venues** | Card grid with status counts. The drawer shows the deposit schedule, linked from Payments. |
| **Paperwork** | Every contract and tax document in one place, each with its type, project, the people and venues it involves, its status (Needed → Drafted → Sent → Signed by them → Fully signed) and dates. Every uploaded file is kept as a version (v1 sent, v2 signed). A **Missing** list flags a confirmed collaborator with no signed agreement, anyone paid with no W-9, a booked venue with no rental agreement or COI, a project with a sponsor but no sponsorship agreement, and anything expiring within 30 days. It also appears on the Dashboard and in each person's and venue's drawer. **Draft from template** fills an agreement from the person, venue and project, saves it as markdown you can edit, and prints or saves it as a PDF; its **fee schedule creates the payments**. A **W-9 tracker** shows on file or not, when it arrived, and a copyable request; it never reads taxpayer ID numbers. The **1099 tracker** totals what you paid each payee per year, with a threshold you set, and has CSV export. A one-click **year-end packet** zips the year's ledger, category totals, 1099 list, receipts and tax documents for your accountant. |
| **Settings** | Vault, your name and company (used in templates), theme (Light, Dark, Pink or follow system), currency, money sources with opening balances, low-balance cushion, fiscal sponsors and fee rates, categories and tags. |

Also included: the Cmd/Ctrl+K command palette (jumps to any screen, project, person, venue, entry or payment), Cmd/Ctrl+N for a new item, Cmd/Ctrl+\ to toggle the sidebar and Cmd/Ctrl+. to close the drawer. Changes save automatically, deletes can be undone, and nothing is hard-deleted: deleted files go to `.manyproduce/trash/`. The desktop app watches the vault folder, so edits made in other apps show up straight away.

The other screens in the sidebar (Shopping list, Equipment log, Campaigns, Templates and Reports) and the Stripboard and Clearances tabs are marked **soon**. Each one shows what it will do.

## Roadmap (build phases from the spec)

1. ✅ Vault and file formats, projects and the project switcher, Bookkeeping ledger with + Income / + Expense and tags
2. ✅ Budget and Payments (tick paid → ledger), automatic sponsor fees, splits
3. ✅ Dashboard with the cash flow forecast
4. ✅ Collaborators and Venues with drawers, Paperwork and tax documents
5. ✅ Schedule builder and Timeline (one Schedule screen), with CSV availability import
6. Shopping list with buyer tags and reimbursements, and the Equipment log
7. Campaigns and Templates
8. Report builder, house reports, venue settlement, daily reports and PDF export
9. Stripboard (a tab on Schedule) and Clearances (a tab on Paperwork)
10. Todoist sync, CSV import/export, backup, packaging, GitHub Releases (the release workflow is already in `.github/workflows/release.yml`)

Not built yet: the theme builder and the shared theme folder, and the option to keep `paperwork/tax/` outside the vault (for example in an encrypted disk image).

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
- All the money logic is plain TypeScript in `src/lib/`, with unit tests in `tests/`. `docs/FILE-FORMATS.md` describes every file.

```
src/
  lib/          vault format, money logic (ledger + sponsor fees, budget, payments, forecast), CSV/frontmatter
  lib/fs/       one filesystem interface, with Tauri and in-memory (browser preview) backends
  components/   sidebar, header, command palette, drawer, inline editors
  screens/      one file per screen
  store.ts      app state (zustand)
src-tauri/      Rust shell: vault-scoped file commands, folder watcher, opening files
tests/          unit tests (vitest)
```

The layout, file conventions and tooling match Many Apply's, so the two codebases feel the same to work in. Budget CSVs use Many Apply's columns and its `Expense / Income / In-kind` types, and totals rows from its export are skipped on import. Unknown frontmatter keys are kept on save, and the app watches the vault folder, so edits made in Obsidian or a text editor show up straight away.

## License

MIT
