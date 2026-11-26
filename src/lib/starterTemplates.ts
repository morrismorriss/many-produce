// Starter templates written into templates/ when a vault is created.
// Plain markdown with [Field] placeholders, so they read fine in any editor.
// These are plain-language starting points, not legal advice.
import type { Template } from "./types";

const t = (slug: string, title: string, group: string, body: string, more: Partial<Template> = {}): Template => ({
  slug, title, group, doc_type: "", subject: "", solicitation: false, body: body.trim(), ...more,
});

export const STARTER_TEMPLATES: Template[] = [
  t("artist-agreement", "Artist agreement", "Agreements", `
# Artist agreement

This agreement is between **[Company]** ("Producer"), represented by [Producer], and **[Name]** ("Artist"), made on [Today].

## The work

Artist will work as **[Role]** on **[Project]**, with rehearsals and performances from [Dates] in [City]. Opening is [Opening].

## Fee and payment

Producer will pay Artist a total of **[Fee]**, as follows:

[Payment schedule]

Artist is an independent contractor, not an employee, and is responsible for their own taxes. Artist will give Producer a completed W-9 before the first payment.

## Schedule and conflicts

Artist has shared their conflicts with Producer. Producer will share the rehearsal schedule at least one week ahead, and Artist will tell Producer about any new conflict as soon as they know.

## Credit

Artist will be credited as "[Role]" in the program and on the production's website.

## Photos and recordings

Producer may use photos and short video clips of the production that include Artist to promote this production and the company's work. Full-length recordings are for archive only unless both sides agree in writing.

## Cancellation

If the production is cancelled, Producer will pay Artist for work already done. Either side can end this agreement with written notice if the other side doesn't do what it says here.

Signed:

______________________________ [Company], [Producer]    Date: __________

______________________________ [Name]    Date: __________
`, { doc_type: "Artist agreement" }),

  t("crew-agreement", "Crew agreement", "Agreements", `
# Crew agreement

This agreement is between **[Company]** ("Producer"), represented by [Producer], and **[Name]** ("Crew member"), made on [Today].

Crew member will work as **[Role]** on **[Project]** from [Dates] in [City].

## Fee and payment

Producer will pay a total of **[Fee]**:

[Payment schedule]

Crew member is an independent contractor and will give Producer a completed W-9 before the first payment.

## Equipment

Anything Crew member borrows from Producer or the venue is returned in the same condition by the end of strike.

Signed:

______________________________ [Company], [Producer]    Date: __________

______________________________ [Name]    Date: __________
`, { doc_type: "Crew agreement" }),

  t("venue-rental", "Venue rental agreement", "Agreements", `
# Venue rental agreement

This agreement is between **[Venue]** ("Venue") and **[Company]** ("Producer"), represented by [Producer], made on [Today].

## Dates and use

Producer will use the space for **[Project]** from [Dates], including load-in, rehearsals, performances and strike. Opening is [Opening]. Capacity is [Capacity].

## Rental fee

Producer will pay Venue **[Fee]**:

[Payment schedule]

## Insurance

Producer will give Venue a certificate of insurance naming Venue as additional insured before load-in.

## Condition

Producer will leave the space as they found it, and will pay for any damage beyond normal wear.

Signed:

______________________________ [Venue]    Date: __________

______________________________ [Company], [Producer]    Date: __________
`, { doc_type: "Venue rental agreement" }),

  t("photo-release", "Photo / video release", "Agreements", `
# Photo and video release

I, **[Name]**, give **[Company]** permission to photograph and record me as part of **[Project]**, and to use those photos and recordings to promote the production and the company's work, in print, online and on social media.

I won't be paid for this use beyond any fee in my other agreements with [Company]. I can ask in writing for a specific image to stop being used going forward.

______________________________ [Name]    Date: __________
`, { doc_type: "Photo / video release" }),

  t("talent-release", "Talent / appearance release", "Agreements", `
# Appearance release

I, **[Name]**, agree that **[Company]** may record my appearance, voice and performance in **[Project]**, and use those recordings in the finished work and to promote it, in any media now known or invented later, worldwide and without time limit. I won't be paid for this beyond any fee in my other agreements with [Company].

If I'm under 18, my parent or guardian signs below too.

______________________________ [Name]    Date: __________

______________________________ Parent / guardian (if under 18)    Date: __________
`, { doc_type: "Photo / video release" }),

  t("location-release", "Location release", "Agreements", `
# Location release

**[Venue]** ("Owner") lets **[Company]** use the property at [address] to film **[Project]** on [Dates], including set-up and clean-up.

[Company] may show the property in the finished work and its promotion, in any media, worldwide and without time limit. [Company] will leave the property as it was found and is responsible for any damage it causes. Fee: [Fee].

______________________________ For the owner    Date: __________

______________________________ [Company], [Producer]    Date: __________
`, { doc_type: "Rights / licensing" }),

  t("materials-release", "Materials release", "Agreements", `
# Materials release

**[Name]** owns [describe the artwork, photo, logo or other material] and gives **[Company]** permission to show it in **[Project]** and in the project's promotion, in [festival / streaming / live performance / all media], [territory], for [term]. Fee: [Fee].

______________________________ [Name]    Date: __________

______________________________ [Company], [Producer]    Date: __________
`, { doc_type: "Rights / licensing" }),

  t("music-request", "Music request letter", "Thank-yous & requests", `
Hi [First name],

I'm producing [Project], a [short film / play] by [Company]. We'd love to use [song title] by [artist] in a scene where [describe the scene], for about [timing].

We're looking for [sync and master] rights for [festival / streaming / live performance], [territory], for [term]. Our budget for this song is [Amount].

Could you let me know whether that's possible, and what you'd need from us?

Thank you,
[Producer]
`, { subject: "Music licence request: [Project]" }),

  t("w9-request", "W-9 request", "Thank-yous & requests", `
Hi [First name],

Before I can pay you for [Project], I need a completed W-9 for my records. You can download the form from irs.gov/w9. Please send it back however you're most comfortable — paper, or a secure file share — rather than plain email, since it has your taxpayer ID number on it.

Thank you!
[Producer]
`, { subject: "W-9 for [Project]" }),

  // Starter set for the Templates screen (spec §15).
  t("ask-first-time", "First-time ask", "Ask letters", `
Hi [First name],

I'm producing [Project], opening [Opening] in [City]. I'd love for you to be part of making it happen.

A gift of [Amount] helps cover [what it pays for]. You can give here: [Link]

Thank you for thinking about it.
[Producer]
`, { subject: "Will you help make [Project] happen?", solicitation: true }),
  t("ask-past-supporter", "Past supporter", "Ask letters", `
Hi [First name],

Your support last time meant a lot. I'm back with [Project], opening [Opening].

Would you consider giving [Amount] again this year? [Link]

With thanks,
[Producer]
`, { subject: "[Project] is coming", solicitation: true }),
  t("cta-instagram", "Instagram caption", "Donation calls to action", `
[Project] opens [Opening] in [City]. 🎭 Help us get there: every gift goes straight to the artists and the space. Link in bio. [Link]
`, { solicitation: true }),
  t("cta-newsletter-ps", "Newsletter P.S.", "Donation calls to action", `
P.S. We're [Amount] away from our goal for [Project]. If you can, chip in here: [Link]
`, { solicitation: true }),
  t("curtain-speech", "Curtain speech", "Donation calls to action", `
Welcome to [Project]! Before we start: phones off, exits are [where]. This show was made possible by people like you. If you loved it tonight, you can give at [Link] or at the table on your way out. Enjoy the show.
`, { solicitation: true }),
  t("thank-you", "Thank-you note", "Thank-yous & requests", `
Dear [First name],

Thank you for your gift of [Amount] to [Project]. It goes directly toward [what it pays for], and it means a lot.

Gratefully,
[Producer]
`, { subject: "Thank you" }),
  t("in-kind-request", "In-kind request", "Thank-yous & requests", `
Hi [First name],

I'm producing [Project] and looking for [item] for [dates]. Would you be open to lending or donating it? We'd credit you in the program as a supporter.

Thank you,
[Producer]
`, { subject: "A small ask for [Project]" }),
];
