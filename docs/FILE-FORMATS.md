# Vault file formats

Everything Many Produce knows lives in the vault folder as plain text. You can open, edit, back up or sync any of it (iCloud, Dropbox, git). The app picks up outside edits when its window regains focus.

```
Many Produce/
  projects/
    <slug>/
      project.md        # project settings (frontmatter) + notes (body)
      budget.csv        # budget lines
      payments.md       # scheduled and paid payments (frontmatter list)
    overhead/           # built in: Company overhead, can't be deleted
  ledger/
    2026.csv            # every income and expense entry, one file per year
    receipts/           # attached receipt files
  people/<slug>.md      # collaborators
  venues/<slug>.md
  sponsors/<slug>.md    # fiscal sponsors and fee rates
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

## .manyproduce/settings.json

This file holds the currency, theme, low-balance `cushion`, `money_sources` (each with `name`, `opening_balance`, `opening_date`, and an optional `sponsor` slug for sponsor funds), the category and tag lists, the last selected project and the forecast length.

A source's current balance is its opening balance plus every ledger entry on that source dated on or after `opening_date`.
