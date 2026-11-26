# Vault file formats

Everything Many Produce knows lives in the vault folder as plain text. You can open, edit, back up or sync any of it (iCloud, Dropbox, git). The app picks up outside edits when its window regains focus.

```
Many Produce/
  projects/
    <slug>/
      project.md        # project settings (frontmatter) + notes (body)
      budget.csv        # budget lines
      payments.md       # scheduled and paid payments (frontmatter list)
      shopping.csv      # the show's shopping list
    overhead/           # built in: Company overhead, can't be deleted
  ledger/
    2026.csv            # every income and expense entry, one file per year
    receipts/           # attached receipt files
  people/<slug>.md      # collaborators
  venues/<slug>.md
  sponsors/<slug>.md    # fiscal sponsors and fee rates
  paperwork/
    contracts/<doc>/      # paperwork.md + file versions (v1-sent.pdf, v2-signed.pdf) + draft.md
    tax/<year>/<doc>/     # W-9s, 1099s issued, tax documents received
    tax/<year>/1099s.csv  # which 1099s you issued, and when
  templates/<slug>.md     # agreement and letter templates with [Field] placeholders
  schedule/
    <project>.csv         # rehearsals, tech, performances, meetings
    <project>-scenes.csv  # scene breakdown (who's in each scene)
    conflicts.csv         # each person's unavailable dates and times
  campaigns/<date>-<slug>.md  # marketing and fundraising campaigns
  inventory/
    items.csv             # Equipment log items (owned, borrowed, rented)
    checkouts.csv         # who has what, when it's due back, condition out/in
  timeline/
    <project>.md          # milestones and tasks, relative to opening
    timeline-templates/<slug>.md
  .manyproduce/
    settings.json
    trash/              # nothing is hard-deleted; it lands here
```

## projects/&lt;slug&gt;/project.md

```yaml
---
slug: prodigy
name: Prodigy
color: "#EE8AAE"
subtitle: Summer 2027 · Chicago
status: planning          # planning | in production | closed
type: Theater             # Theater | Film | Other
start: 2026-10-17
end: 2027-07-14
opening: 2027-07-04
city: Chicago
fiscal_sponsor: fractured-atlas   # sponsor slug, or blank
sponsor_fee_rate: null             # e.g. 0.08 to override the sponsor's rate
---
Notes in markdown.
```

The folder name is the project's slug.

## ledger/YYYY.csv

```
id,date,kind,amount,description,project_alloc,category,source,counterparty,tags,receipt,restricted_to,linked_payment,linked_shopping_item,notes
```

- `kind` is `income` or `expense`. `amount` is always positive.
- `project_alloc` is one slug (`prodigy`) or a split: `prodigy:0.6;made-men-reading:0.4`. The shares add up to 1.
- `source` is the money source: `Checking`, `Card`, `Cash`, `Fractured Atlas fund`, `Direct (earned income)` and so on.
- `tags` are separated by semicolons: `Through fiscal sponsor;Restricted`.
- An automatic sponsor-fee entry has `notes` = `auto-fee:<income id>`. It's kept in step with that income entry.
- `linked_payment` is the payment id when the entry was created by ticking a payment paid.

## projects/&lt;slug&gt;/budget.csv

The first seven columns match Many Apply's budget builder exactly, so budgets move between the two apps:

```
category,type,line_item,quantity,rate,amount,notes,id,expected_date,confidence,through_sponsor,source
```

- `type` is `expense` or `income`.
- `expected_date`, `confidence` (`Confirmed` | `Likely` | `Hoped for`), `through_sponsor` (`yes` or blank) and `source` (the money source the income lands in) are used for income lines and the forecast.
- Paid-to-date for expense lines comes from the ledger, matched by category.

## projects/&lt;slug&gt;/payments.md

```yaml
---
payments:
  - id: p3
    title: Venue deposit (2 of 2)
    payee: Uptown Studio Theatre
    method: Fractured Atlas fund     # money source it's paid from
    budget_line: b1
    category: Venue rental
    due: 2027-01-05
    amount: 1500
    status: scheduled               # scheduled | paid
    paid_date: ""
    ledger_id: ""                   # set when ticked paid
    project_alloc: prodigy
    notes: ""
---
```

A split payment is stored with the project that has the biggest share.

## people/&lt;slug&gt;.md

Frontmatter: `name, roles, projects, email, phone, city, rate, rate_type (flat | hourly | per show | stipend), status (Reached out | Offer out | Confirmed | Past collaborator), pronouns, payment_method, w9_on_file (yes | no)`. The body holds notes.

The app only records whether a W-9 is on file. It never reads or stores taxpayer ID numbers.

## venues/&lt;slug&gt;.md

Frontmatter: `name, type, city, capacity, rate, tech_notes, status (Contacted | Toured | Hold | Booked | Passed), projects, next_step, contact, hold_dates`. The body holds notes.

## sponsors/&lt;slug&gt;.md

Frontmatter: `name, fee_rate (0.08 = 8%), fee_applies_to, contact, account_url, review_required_for, report_schedule`. New vaults start with presets for Fractured Atlas (8%) and Producer Hub (2%).

## paperwork/…/&lt;doc&gt;/paperwork.md

```yaml
---
title: Ana Reyes director agreement
type: Artist agreement        # or Crew agreement, Venue rental agreement, Certificate of insurance (COI), W-9, …
project: prodigy              # blank = company-wide
people: [ana-reyes]
venues: []
status: Fully signed          # Needed | Drafted | Sent | Signed by them | Fully signed | Expired | Void
sent: 2026-10-27
signed: 2026-10-31
effective: 2026-10-31
expires: ""
amount: 1500
schedule:                     # fee schedule; each installment links to the payment it created
  - { amount: 500, due: 2026-11-05, payment_id: p1 }
files:                        # every uploaded version is kept
  - { label: v1 sent, file: v1-sent.pdf, added: 2026-10-27 }
  - { label: v2 signed, file: v2-signed.pdf, added: 2026-10-31 }
template: artist-agreement    # if drafted from a template
---
Notes.
```

A draft made from a template is saved next to it as `draft.md`. Documents of type W-9, 1099 issued and Tax document received are filed under `paperwork/tax/<year>/`.

The app never reads the contents of a W-9. People records only hold `w9_on_file` and `w9_date`.

`paperwork/tax/<year>/1099s.csv` has the columns `payee, issued_date, notes`.

## templates/&lt;slug&gt;.md

```yaml
---
title: Artist agreement
group: Agreements             # Agreements, Ask letters, Donation calls to action, Thank-yous & requests
doc_type: Artist agreement    # agreement templates: the Paperwork type a draft becomes
subject: ""                   # letters: subject line, may contain [Fields]
solicitation: false           # true = "Needs fiscal sponsor review"
---
Body with [Producer], [Company], [Name], [First name], [Role], [Project], [Dates], [Opening],
[City], [Venue], [Fee], [Payment schedule], [Today]…
```

New vaults start with plain-language agreement templates (artist, crew, venue rental, photo/video release) and the spec's starter letters. Fields with no value are left in brackets for you to fill in.

## schedule/&lt;project&gt;.csv

```
id,date,start,end,type,title,location,called,scenes,notes
```

`start` and `end` are `HH:MM` in local time (blank = time to be decided). `location` is a venue slug or free text. `called` and `scenes` are separated by semicolons (person slugs and scene ids). `.ics` exports use floating local times, so they show at the same clock time in any calendar.

## schedule/conflicts.csv

```
id,person,date,start,end,note
```

A blank `start` means the person is out all day.

### Importing availability

**Import availability (CSV)** on the Availability tab understands two shapes:

- **Grid:** a name column, then one column per date (`12/8`, `Dec 8`, `Mon 12/8`, `2026-12-08`; a missing year means the next time that date comes around). You choose whether a marked cell (`x`, `yes`, `✓`) means available or unavailable. `busy`, `can't` and `out` always mean a conflict, and `free` or `available` never do. Cells with times narrow it: `after 6pm` (busy until 6 in an unavailable sheet), `before 2`, `2–5pm`. Anything else becomes an all-day conflict, with the text kept as the note.
- **Rows:** columns `name, date` and optionally `start, end, note`.

Names are matched to collaborators by full name, then by a unique first name, then by email. Re-importing replaces each person's older conflicts on the imported dates.

## schedule/&lt;project&gt;-scenes.csv

```
id,number,title,characters
```

`characters` is semicolon-separated. Who plays whom lives in the project's `project.md` as `cast: { CARMELA: maya-ostrowski, … }`.

## timeline/&lt;project&gt;.md

```yaml
---
tasks:
  - id: t1
    title: Book the space
    rel: { anchor: opening, days: -28 }   # or due: 2027-01-12 for a fixed date
    owner: producer                       # or a person slug
    status: To do                         # To do | Doing | Done | Skipped
    department: Producing
    todoist: false
---
```

Anchors are `start`, `first_rehearsal`, `tech`, `opening`, `closing` and `end`. They come from the project's dates, or from the Schedule (the first rehearsal or read-through, the first tech, and the first and last performances). Timeline templates in `timeline/timeline-templates/` use the same task format, with `title` and `description`.

## projects/&lt;slug&gt;/shopping.csv

```
id,item,where,link,department,buyer,buyer_role,need_by,est_cost,actual_cost,money,status,receipt,notes,payment_id,ledger_id,inventory_id
```

- `buyer` is `producer`, a person slug, or blank (unassigned). `buyer_role` is `producer`, `designer`, `other` or `unassigned`.
- `money` is `Producer card`, `Reimburse`, `In-kind`, `Paid by venue`, or the name of a sponsor-fund money source.
- `status` is `Needed`, `Got it` or `Reimbursed`.
- `payment_id` points at the reimbursement payment, and the payment carries `shopping_item` back. `ledger_id` points at the expense entry for something you paid for directly. `inventory_id` is set once the item moves into the Equipment log.

## inventory/items.csv

```
id,name,category,owner,project,serial,value,rental_house,rental_order,rental_cost,rental_start,rental_end,deposit,deposit_returned,returned,condition,notes
```

`owner` is `producer`, `person:<slug>`, `venue:<slug>`, or free text. Rented items have a `rental_house`. Items with the same `rental_order` are shown as one order.

## inventory/checkouts.csv

```
id,item,person,out_date,due_date,in_date,condition_out,condition_in,notes
```

A blank `in_date` means it's still out.

## campaigns/&lt;date&gt;-&lt;slug&gt;.md

```yaml
---
title: Giving Tuesday push
type: Fundraising            # Fundraising | Marketing
project: prodigy
channel: Newsletter
status: Scheduled            # Ideas | Drafting | Scheduled | Done
date: 2026-12-01
end_date: 2027-01-17         # optional; with a goal, the Campaigns goal tracker counts gifts between the dates
template: cta-newsletter-ps
goal: 6000
asks_sent: 120
responses: 14
result_amount: null          # typed-in result; otherwise filled from linked_entries
result_notes: ""
linked_entries: [e12, e15]   # Bookkeeping entries this campaign brought in
---
The draft or notes.
```

## .manyproduce/settings.json

This file holds the currency, theme, low-balance `cushion`, `money_sources` (each with `name`, `opening_balance`, `opening_date`, and an optional `sponsor` slug for sponsor funds), the category and tag lists, the last selected project, the forecast length, `producer_name` and `company_name` (used in templates), `threshold_1099` (the 1099 reporting threshold, which you can change because IRS rules change) `doc_types` (your own document types) and `max_hours_week` (the weekly hours-called warning; 0 = off).

A source's current balance is its opening balance plus every ledger entry on that source dated on or after `opening_date`.
