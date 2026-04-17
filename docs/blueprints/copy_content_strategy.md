# LaSyncro — Copy & Content Strategy Blueprint

### Complete, Production-Ready Guide for Consistent Messaging and Improved Conversion

**Version 1.0 — April 2026**
**Classification: Internal — Founding Team**

---

## Table of Contents

1. [Brand Voice & Tone](#1-brand-voice--tone)
2. [Core Messaging Architecture](#2-core-messaging-architecture)
3. [Audience & ICP Definition](#3-audience--icp-definition)
4. [Website Copy](#4-website-copy)
5. [Shopify App Store Listing](#5-shopify-app-store-listing)
6. [OAuth & Installation Flow](#6-oauth--installation-flow)
7. [Sync & Loading States](#7-sync--loading-states)
8. [First Aha Moment](#8-first-aha-moment)
9. [In-App Copy System](#9-in-app-copy-system)
10. [Onboarding Email Sequence](#10-onboarding-email-sequence)
11. [Lifecycle & Retention Emails](#11-lifecycle--retention-emails)
12. [Pricing Page Copy](#12-pricing-page-copy)
13. [Error States & Edge Cases](#13-error-states--edge-cases)
14. [Social & Content Marketing](#14-social--content-marketing)
15. [Copy QA Checklist](#15-copy-qa-checklist)

---

## 1. Brand Voice & Tone

### 1.1 The Name and Its Meaning

LaSyncro comes from **"Let's Sync Up"** — itself a compression of **"Let's Sync Up Your Rows"**, where *rows* refers to the merchant's database rows: every order, every product variant, every supplier record, every warehouse movement.

This origin is a founding myth and a commercial asset. "Syncs up every row" is copy that works on two levels simultaneously:

- A merchant who does not know the origin reads it as a completeness claim — every part of the operation, connected.
- A merchant who does know the origin feels a moment of brand craft — a name that means what it does.

**Rule:** The phrase *"syncs up every row"* or *"let's sync up every row"* must appear verbatim in at least one location per major copy surface: the website footer CTA, the App Store closing line, and the onboarding email sign-off.

---

### 1.2 Voice Pillars

LaSyncro speaks with four qualities in every piece of copy. These are not aspirational values — they are behavioural constraints that every writer and every product team member must apply before publishing anything.

**Operational** — LaSyncro talks like someone who has worked a warehouse floor and run a supplier negotiation, not like a SaaS marketing team. Avoid abstract platform language. Prefer concrete, physical, commercial language.

> Not: *"Streamline your operational workflows with intelligent automation."*
> Yes: *"The moment a PO is scanned in, held orders release. Inventory updates. Stow tasks push to your operator's phone."*

**Honest** — LaSyncro never overpromises. It does not claim to "transform your business" or "revolutionise your supply chain." It makes specific, falsifiable claims that a merchant can verify against their own data within the first session.

> Not: *"Transform the way you run your business forever."*
> Yes: *"Most merchants find their first stock-out risk signal within four minutes of their operation loading."*

**Warm without being soft** — LaSyncro treats the merchant as an intelligent adult who works hard, makes real decisions, and doesn't need to be patronised. It is never cheerful in the hollow SaaS sense. It is warm in the way a trusted advisor is warm: direct, clear, and on their side.

> Not: *"Woohoo! Your sync is complete! 🎉 Let's get started!"*
> Yes: *"Your operation is synced. Here's what we found in the first pass."*

**Precise** — Every number is real. Every claim is specific. Vague copy ("improve your efficiency") is never used. When LaSyncro makes a claim, it is anchored to a metric, a scenario, or a named mechanic.

> Not: *"LaSyncro helps you make better decisions."*
> Yes: *"LaSyncro shows you which suppliers have a fill rate below 90% — automatically, from every delivery, without any manual tracking."*

---

### 1.3 Tone Modulation by Context

The voice stays consistent. The tone adapts to context.

| Context | Tone | Example |
|---|---|---|
| Marketing website — hero | Confident, direct, slightly urgent | "Your operation, finally synced up." |
| Marketing website — body | Narrative, honest, human | The 8am problem section |
| Shopify App Store listing | Problem-first, outcome-focused | "Stop finding out SKUs stocked out from angry customer emails." |
| OAuth screen | Reassuring, transparent, specific | "This takes 60 seconds and can be reversed any time." |
| Sync waiting screen | Alive, purposeful, anticipatory | "We're finding it now. It's already in your data." |
| First dashboard / Aha | Clear, commercial, immediately actionable | "3 SKUs will stock out within 7 days. £47,200 at risk." |
| In-app empty states | Motivating, specific, tied to a consequence | "Add an ETA to enable delivery alerts and auto-release held orders." |
| In-app success states | Satisfying, complete, show the cascade | "PO received. Here's what just happened automatically." |
| Error messages | Honest, specific, never blame the merchant | "We couldn't connect to Shopify. Here's what to try." |
| Onboarding emails | Personal, data-driven, one job per email | Subject: "Your operation just loaded. Here's what we found." |
| Churn / cancel flow | Calm, non-manipulative, offer the pause | "No pressure. You can pause for up to 3 months instead." |
| Review request | Direct, personal, from a founder | "One question about your first three weeks." |

---

### 1.4 Words to Use and Avoid

**Use:**

- Operation, operational
- Row, rows (when contextually appropriate — the brand's signature)
- Synced, syncs up
- Signals, surfaces, shows you
- Warehouse, floor, scan, receive, stow, pick, pack
- Supplier, fill rate, on-time, delivery
- Velocity, demand, restock risk
- Held, auto-release, cascade
- Morning Brief
- Real-time, live
- Merchant (not "user" or "customer")
- Operator (not "staff" or "worker")

**Avoid:**

- Streamline, optimise, leverage (hollow verb syndrome)
- Revolutionary, transformative, game-changing
- Seamless, frictionless (ironically high-friction words)
- Platform (unless contrasting with a competitor)
- Solution (never "LaSyncro is the solution to...")
- Empower, unlock potential, drive growth
- We're excited to... / We're proud to...
- Deep dive, synergy, holistic
- Exclamation marks in UI copy (one exception: the PO cascade confirmation modal, where genuine delight is warranted)

---

### 1.5 Writing Test

Before publishing any copy, apply this three-part test:

1. **Could a competitor say this without changing a word?** If yes, it is not LaSyncro copy — it is generic SaaS copy. Rewrite with specifics.
2. **Does it describe a feature or an outcome?** Features are inputs. Outcomes are what the merchant cares about. Lead with outcomes; explain features second.
3. **Would the 8am merchant read this and feel understood?** The ICP is a merchant who woke up to three customer complaint emails and a supplier who can't find their PO. Copy that doesn't speak to that person's reality is not LaSyncro copy.

---

## 2. Core Messaging Architecture

### 2.1 The Master Narrative

Every piece of LaSyncro communication, from the hero headline to the error message, traces back to one narrative arc:

> **SMB merchants work extraordinarily hard. They fail not from lack of effort, but from lack of infrastructure. Their tools — spreadsheets, WhatsApp, disconnected platforms — were never designed to work together. LaSyncro is the connective tissue that makes the operation coherent: a single, governed, real-time source of truth that replaces daily firefighting with structured intelligence.**

This narrative has three beats:

- **Beat 1 — Validation:** "This is not a failure of effort." The merchant is absolved of blame. The infrastructure is the problem, not them.
- **Beat 2 — Diagnosis:** Fragmentation is the enemy. The tools don't talk to each other. Every insight requires manual assembly.
- **Beat 3 — Resolution:** LaSyncro is not another tool. It is the connective tissue. One system. Every row.

Not every piece of copy uses all three beats. But every piece of copy is consistent with the arc.

---

### 2.2 Hierarchy of Messages

**Tier 1 — The primary claim (one sentence, always true):**
> LaSyncro is the operational central nervous system for SMB commerce.

**Tier 2 — The proof structure (what that means, five modules):**

1. Purchase orders that do the work — structured POs, scan-receive, held order auto-release
2. Warehouse that runs itself — barcoded locations, operator task queues, movement tracking
3. Supplier accountability, automatically — on-time rate, fill rate, defect rate, built from every delivery
4. Demand signals before stockouts — velocity-based restock risk, days-of-stock-remaining
5. Your operation, every morning — the Morning Brief, proactive signals before the day begins

**Tier 3 — The conversion argument (why now, why LaSyncro):**

- Connects to Shopify in 60 seconds
- Your data is readable from the first session — no manual setup required to see value
- Free to start — no credit card required
- 14-day Growth trial included — the full intelligence tier, risk-free

**Tier 4 — The trust layer (why it's safe to commit):**

- Data is yours — export everything, delete everything, any time
- No cross-tenant data access — architectural guarantee, not a policy
- Disconnect any time — no lock-in through data hostage
- GDPR-ready — DPA embedded in onboarding, SCCs for EU/US transfers

---

### 2.3 The Five Transformation Statements

These are LaSyncro's proof points, written as before/after pairs. Use them on the website, in the App Store listing, in sales collateral, and in product onboarding. Never use them as bullet points — always as full pairs.

| Before | After |
|---|---|
| Finding out a SKU stocked out from an angry customer email | Stock-out risk surfaced 4 days before the customer notices |
| POs negotiated on WhatsApp, tracked on a spreadsheet | One structured PO — scan to receive — inventory updates automatically |
| Supplier always "on their way" — no data on who's actually reliable | On-time rate, fill rate, defect rate — built from every delivery, automatically |
| Operator asking which shelf to use because the location doc is from February | Barcoded locations — scan to stow — every movement tracked |
| Owner running margin calculations with last month's exchange rates in Excel | Real-time margin per order, demand velocity per SKU, cash flow projection updated on every receive |

---

### 2.4 The Tagline Portfolio

LaSyncro does not have one tagline — it has a portfolio of taglines for different contexts and A/B tests. Each serves a different emotional entry point.

| Tagline | Emotional entry | Best context |
|---|---|---|
| "Your operation, finally synced up." | Validation + relief | Hero headline |
| "The operational brain for serious Shopify merchants." | Aspiration + positioning | App Store tagline, LinkedIn bio |
| "Stop running your warehouse on WhatsApp." | Pain + urgency | Paid ads, cold outreach |
| "Everything your spreadsheet can't tell you." | Curiosity + frustration | Retargeting, email subject lines |
| "Let's sync up every row." | Brand signature | Footer CTA, email sign-off |
| "Know before it breaks." | Proactivity + confidence | Feature-specific, Morning Brief landing |
| "Built for merchants who mean business." | ICP qualifier | Partnership collateral, co-marketing |

---

## 3. Audience & ICP Definition

### 3.1 Primary ICP — The Owner-Operator

**Who they are:**
The primary buyer is the owner or operations director of a Shopify merchant doing £500K to £10M in annual revenue, fulfilling orders from their own warehouse with their own warehouse staff. They are almost always the person who feels the pain most acutely — they are simultaneously the buyer, the operations manager, and sometimes the warehouse worker.

**What their day looks like:**

- Shopify admin is always open in a tab
- A supplier WhatsApp group is pinging
- An Excel spreadsheet called "Inventory v7 FINAL (2).xlsx" exists somewhere
- A warehouse operator is asking them something they shouldn't need to ask
- A customer complaint email arrived before 9am
- A restock that should have arrived is late with no update

**What they care about, in order:**

1. Not stocking out — lost sales are visible and painful
2. Knowing what's actually happening without asking someone
3. Not finding out about problems after they've become crises
4. Their team working from the same information they are
5. Understanding which suppliers are costing them money

**What they are afraid of:**

- Another tool that requires weeks of setup before showing any value
- Their data going somewhere it shouldn't
- Losing operational visibility if they disconnect
- Being locked into a contract they can't exit

**How they describe their current pain (verbatim language to mirror):**

- "I find out we're out of stock when a customer emails"
- "Everything lives in my head or in a WhatsApp thread"
- "I have no idea which supplier is actually reliable"
- "My operator is asking me something every 10 minutes"
- "The spreadsheet is always wrong by the time someone updates it"

---

### 3.2 Secondary ICP — The Operator

The operator is not the buyer, but they are the person who creates the physical behavioral lock-in that makes LaSyncro sticky. If an operator has used the mobile scan-receive flow once, the merchant will not cancel.

**Who they are:**
A warehouse team member — often the first warehouse hire — who picks, packs, receives, and stows. They use LaSyncro on a phone. They do not see financial data. They work from task queues.

**What they care about:**

- Knowing exactly what to do next
- Not being blamed when something goes wrong
- Simple, fast, physical interfaces
- Not having to ask the owner questions that should already be answered by the system

**Copy implications:**

- All operator-facing copy must be action-verb-first: "Scan the barcode", "Confirm 60 units", "Stow in A-01-2"
- Zero financial data visible to operators — never imply otherwise in copy
- Success states must be immediate and unambiguous — no "are you sure?" friction

---

### 3.3 Audience Exclusions

Copy should never speak to, or be optimised for:

- Dropshippers (no warehouse = no WMS value)
- 3PL-dependent merchants (warehouse is outsourced = no operator use case)
- Merchants under £100K revenue (pre-PMF, high churn, wrong fit)
- Enterprise (£50M+) without specific sales context
- Developers or technical evaluators (this is an operator tool, not a dev tool)

**The ICP qualifier line** (use in listings and landing pages to filter for fit):
> "LaSyncro is built for Shopify merchants doing serious volume from their own warehouse — typically £500K to £10M+ in revenue, with high SKU complexity and a small warehouse team."

This line will appear to shrink the audience. In practice, it increases conversion from the right merchants and reduces churn from wrong-fit installs.

---

## 4. Website Copy

### 4.1 Hero Section

**Eyebrow (above H1):**
> Built for Shopify merchants who run their own warehouse

**H1:**
> Your operation,
> finally synced up.

**Subheadline:**
> LaSyncro connects every row of your business — orders, inventory, suppliers, warehouse, and workforce — into one real-time picture you can actually act on.

**Primary CTA:**
> Start free — 14-day Growth trial included

**Trust line (below CTA):**
> No credit card · Connects to Shopify in 60 seconds · Cancel anytime

**Design note:** The H1 line break is intentional — "finally synced up" lands on its own line for emphasis. The word "finally" is the emotional core of the headline: it validates years of frustration without requiring the merchant to explain that frustration.

---

### 4.2 The 8am Problem Section

This section appears directly below the hero. It is the narrative hook — the moment where the merchant recognises themselves in the copy. It must be written in present tense, as if happening right now.

**Section heading (optional, can be omitted):**
> Sound familiar?

**Body:**
> It's 8am. Three customer emails about delayed orders sit unanswered. A supplier is waiting on a PO confirmation that was agreed over WhatsApp three weeks ago and nobody can find the thread. Your warehouse operator is asking which shelf the new stock goes on because the location spreadsheet was last updated in February. And somewhere in all of this, a restock that should have arrived Tuesday is now four days late with no update from the supplier.
>
> This is not a failure of effort. SMB operators work extraordinarily hard. This is a failure of infrastructure.
>
> LaSyncro exists to end this.

**Writing rules for this section:**

- Never change "This is not a failure of effort" — this sentence is the emotional release that converts browsers into installers
- Keep present tense throughout ("sits", "is waiting", "is asking") — past tense reduces the visceral recognition
- The details (WhatsApp, February spreadsheet, Tuesday restock) must remain specific — general language ("you might have inefficiencies in your workflow") is invisible

---

### 4.3 Before/After Transformation Section

**Section heading:**
> What LaSyncro changes

Present the five transformation pairs as a visual before/after table or alternating rows. Do not present as bullet lists — the paired structure is what communicates the delta.

Each pair should be preceded by its module name:

- **Purchase orders:** Finding out a SKU stocked out from an angry customer email → Stock-out risk surfaced 4 days before the customer notices
- **Warehouse:** Operator asking which shelf to use because the location doc is from February → Barcoded locations — scan to stow — every movement tracked
- **Suppliers:** Supplier always "on their way" — no data on who's actually reliable → On-time rate, fill rate, defect rate — built from every delivery, automatically
- **Demand:** Running margin calculations with last month's data → Real-time stock velocity per SKU — restock risk surfaced before the stockout
- **Intelligence:** Finding out what's happening by asking someone → Your Morning Brief — what needs attention, before the day begins

---

### 4.4 Feature Narrative Sections

Each module gets a dedicated section. The structure is: **outcome headline → one-sentence mechanism → two-to-three concrete proof points**.

**Purchase Orders**

*Headline:* POs that do the work

*Mechanism:* When a PO is fully received via barcode scan, LaSyncro triggers six things simultaneously: inventory updates, held orders release, stow tasks push to your operator, COGS commit to your cash flow model, Shopify stock levels sync, and demand projections refresh.

*Proof points:*

- Create a PO in 3 minutes, with line items, ETAs, and supplier accountability
- Receive stock by scanning barcodes from a phone — no spreadsheet, no manual count
- 4 customer orders on hold? They auto-release the moment the last barcode is scanned

---

**Warehouse Management**

*Headline:* A warehouse with a memory

*Mechanism:* Every location gets a barcode. Every product gets a system identity. Every movement — received, stowed, picked, packed, shipped — is tracked in real time.

*Proof points:*

- Operators work from structured task queues, not verbal instructions
- Pick, pack, receive, and stow sessions are tracked and logged — exceptions recorded, not forgotten
- Inventory is derived from actual movements, not manual counts that go stale overnight

---

**Supplier Intelligence**

*Headline:* Know which suppliers are costing you money

*Mechanism:* Every delivery builds an objective supplier rating — on-time rate, fill rate, defect rate, average delivery delta — without any manual tracking.

*Proof points:*

- After 5 deliveries, you know which supplier is reliable and which is quietly costing you through lateness and shortfalls
- Supplier ratings surface directly in your restock recommendations — so you're always ordering from the right source
- No more "they said they'd deliver Tuesday" — actual delivery data, every time

---

**Demand Intelligence**

*Headline:* Restock risk before the stockout

*Mechanism:* LaSyncro measures actual sales velocity per SKU and calculates days-of-stock-remaining in real time — surfacing restock signals before customers experience the gap.

*Proof points:*

- Stock-out risk ranked by commercial urgency: days remaining × daily revenue at risk
- Demand signals update every time an order lands or stock moves
- Restock recommendations connect directly to your preferred supplier for each SKU

---

**The Morning Brief**

*Headline:* Know before it breaks

*Mechanism:* Every morning, LaSyncro composes a prioritised snapshot of your operation — stock risks, arriving POs, held orders, supplier alerts, and workforce load — so the day begins with clarity, not firefighting.

*Proof points:*

- Delivered by email or push notification before you open Shopify
- Prioritised by commercial consequence — what costs you the most, first
- Acts as your daily anti-churn mechanism: the morning you skip the Brief is the morning something slips

---

### 4.5 Pricing Section

**Section heading:**
> Transparent pricing. No per-seat surprises.

**Intro copy:**
> Start free, grow into the tier that fits your operation. The Growth tier — where most serious merchants end up — pays for itself the first time it prevents a stockout.

**Tier names and headlines:**

- **Starter — Free:** "See what you've been missing." The demand funnel. 50 orders/month, 1 operator. No intelligence features.
- **Core — £79/month:** "Your first warehouse operator tier." WMS, POs, and the foundation — 2 seats, 500 orders.
- **Growth — £179/month:** "Where intelligence unlocks." Cash flow projection, demand intelligence, LTV signals, 5 seats. This is where most merchants land permanently.
- **Scale — £349/month:** "Serious volume, no limits." Unlimited everything, floor planning, barcode generation, custom DPA.

**Pricing reassurance line (below the tier table):**
> Annual billing saves 20% — that's two months free. All plans include a 14-day Growth trial. No credit card required to start.

**ROI anchor line:**
> At £179/month, LaSyncro costs less per day than a single unplanned stockout costs in lost revenue.

---

### 4.6 Social Proof Section

**Pre-reviews (first 90 days):**

Use the founder story as proof:

> LaSyncro was built because we lived the 8am problem. Every feature in the product came from a real merchant asking for it. We're not a SaaS company that discovered logistics — we're operators who built software to solve what we couldn't buy.

**Post-reviews (once collected):**

The ideal testimonial format, driven by the day-21 email question ("What's the first thing LaSyncro showed you that you didn't know before?"):

> "I found out we had three SKUs about to stock out — I had no idea. That was in the first four minutes. LaSyncro paid for itself before I finished the setup." — [Merchant name], [Store type]

**Metrics proof block (once live data is available):**
> Merchants using LaSyncro catch stock-out risk an average of [X] days before it affects customers.
> The average merchant sees their first actionable intelligence signal within [X] minutes of syncing.

---

### 4.7 Footer CTA

**Heading:**
> Your spreadsheets aren't going to sync themselves.

**Body:**
> Start free. Connect Shopify in 60 seconds. See your own operation clearly for the first time.

**CTA button:**
> Start free — 14-day Growth trial included

**Brand closing line:**
> LaSyncro — let's sync up every row.

---

## 5. Shopify App Store Listing

### 5.1 App Title

**Recommended:**
> LaSyncro — Warehouse + Operations

**Alt (keyword-leaning):**
> LaSyncro: WMS, POs & Inventory

**Rationale:** Lead with the brand name — it is distinctive and memorable. The category descriptor ("Warehouse + Operations") signals the module breadth to the App Store algorithm and to human scanners. "Warehouse + Operations" is broader than "WMS" and speaks to the owner (the buyer), not a logistics professional.

---

### 5.2 Tagline (160 characters)

> The operational brain for serious Shopify merchants.

**Alt (visceral / pain-led):**
> Stop running your warehouse on spreadsheets and WhatsApp.

**A/B test recommendation:** Run tagline A (aspirational) at launch. Switch to Alt if install conversion rate is below 20% at 30 days.

---

### 5.3 Short Description (appears in search result cards, ~160 characters)

> LaSyncro syncs up every row of your operation — orders, inventory, suppliers, warehouse, and workforce — into one real-time picture of your business.

**Keyword density check:** "inventory", "warehouse", "orders", "suppliers" all present. "Syncs up every row" is the brand signature working as product copy.

---

### 5.4 Long Description

**Opening hook (must appear within the 300-character preview before "read more"):**

> It's 8am. Three customer emails about delayed orders. A supplier waiting on a PO that was agreed over WhatsApp three weeks ago — nobody can find the thread. Your operator is asking which shelf the new stock goes on.
>
> This is not a failure of effort. It's a failure of infrastructure.
>
> LaSyncro exists to end this.

---

**The solution block:**

> LaSyncro is the operational central nervous system for SMB commerce. It replaces the spreadsheets, the WhatsApp threads, and the daily firefighting with structured workflows, automated intelligence, and signals that surface before problems become crises.

---

**Five capability blocks:**

**Purchase orders, finally structured.**
Create POs with line items, ETAs, and supplier accountability. Receive stock by scanning barcodes from your phone. The moment a PO lands, inventory updates, held orders release, and your cash flow model refreshes — automatically.

**Warehouse that runs itself.**
Every location has a barcode. Every movement is tracked. Operators work from structured pick, pack, and stow queues — not verbal instructions. Exceptions are recorded. Inventory accuracy improves with every session.

**Supplier intelligence, not supplier guesswork.**
Every delivery builds a supplier rating: on-time rate, fill rate, defect rate. Over time, LaSyncro tells you which suppliers are reliable and which are quietly costing you money — without any manual tracking.

**Demand signals before stockouts happen.**
Restock needs are predicted from actual sales velocity and current stock — not gut feel. Stock-out risk surfaces days before a customer complains.

**Your operation, every morning.**
The Morning Brief tells you what needs attention before the day begins. You stop reacting and start operating.

---

**Closing — who it's for:**

> LaSyncro is built for Shopify merchants doing serious volume from their own warehouse — typically £500K to £10M+ revenue, high SKU complexity, and a small team that needs to punch above its weight.
>
> If you're still running operations on spreadsheets, you're leaving money on the table every single day.
>
> LaSyncro syncs up every row.

---

### 5.5 Keyword Strategy

**Primary keywords (embed in title, short description, and capability headings):**
warehouse management, inventory management, purchase orders, WMS, stock management, order fulfillment, supplier management, barcode scanning

**Secondary keywords (embed in body copy):**
pick and pack, stock receiving, demand forecasting, PO management, warehouse locations, inventory tracking, stockout prevention, cash flow inventory, warehouse staff, bin locations, reorder points, supplier rating

**Long-tail keywords (embed naturally in capability blocks):**
warehouse management shopify, shopify WMS, purchase order shopify, shopify inventory receiving, shopify barcode warehouse, shopify pick pack, shopify fulfillment team

---

### 5.6 Screenshot Storyboard

Screenshots are listed in display order. Screenshot 1 is the only one visible before click-through in search results — it carries the full conversion burden of the first impression.

**Screenshot 1 — The Morning Brief (the hook)**
Show the Morning Brief dashboard with real-looking data: merchant name ("Good morning, Jamie"), two alert strips (arriving PO, stock-out risk), three KPI cards (open orders, stock value inbound, pick accuracy).
*Caption:* "Know before it breaks — your Morning Brief surfaces stock risks, arriving POs, and held orders before the day begins."

**Screenshot 2 — Purchase order list**
Show the PO list view with status badges: arriving today (red), in transit (amber), received (green). Show the held orders count strip.
*Caption:* "POs that do the work — track every shipment, scan to receive, watch held orders auto-release the moment stock lands."

**Screenshot 3 — Mobile scan-receive**
Show the mobile receive session: camera viewfinder active, SKU name, supplier, units expected, real-time scanned counter.
*Caption:* "Scan to receive, instantly — your operator scans, inventory updates live. No counting. No spreadsheet."

**Screenshot 4 — Supplier ratings**
Show two supplier cards: one with 5-star rating and "98% on-time / 100% fill" tags; one with 2-star rating and "67% on-time / 82% fill rate" in coral/red.
*Caption:* "Supplier truth, automatically — on-time rate, fill rate, defect rate built from every delivery without manual tracking."

**Screenshot 5 — Demand signals**
Show three SKU risk rows: red (2 days left), amber (5 days), green (18 days / healthy). Each with days-of-stock and daily velocity.
*Caption:* "Stockouts predicted, not discovered — demand velocity tells you what to reorder before customers notice it's gone."

**Screenshot 6 — Social proof quote**
White card with merchant quote, 5-star rating, and merchant name/store type. Collect this quote at day 21.
*Ideal quote format:* "Before LaSyncro, I found out we'd stocked out from an angry customer email. Now I know 4 days in advance." — [Name], [Store]

---

## 6. OAuth & Installation Flow

### 6.1 OAuth Screen Copy

The OAuth screen is the moment of highest anxiety in the entire purchase journey. The merchant has decided to install and is one confirmation away from committing. Every word must reduce anxiety, not increase it.

**Screen title:**
> LaSyncro wants to connect to your Shopify store

**Subheading:**
> This takes 60 seconds and can be reversed any time

**Permissions block — always include the "why" for each permission:**

| Permission | Why explanation |
|---|---|
| Orders and order details | To build your fulfillment queue and risk-score delayed orders |
| Products and inventory levels | To track stock movements and calculate demand velocity |
| Customer information | To calculate LTV and flag at-risk customers — never shared or sold |

**"LaSyncro will never" block (place before the confirm button):**
> LaSyncro will never:
> — Modify your orders without your instruction
> — Access payment card data (Shopify owns this, not us)
> — Share your data with third parties or advertisers

**CTA button:**
> Connect my Shopify store

**Footer reassurance text:**
> Your store data is encrypted in transit and at rest. You can disconnect and delete all data at any time from your LaSyncro settings. Questions? <hello@lasyncro.com>

---

### 6.2 Post-Install Redirect Copy

The screen that appears immediately after OAuth completes, before sync begins:

**Heading:**
> Connected. Now let's read your operation.

**Subheading:**
> LaSyncro is pulling your orders, products, and inventory from Shopify right now. This takes 2–4 minutes — it's worth the wait.

**Body:**
> We're building your fulfillment queue, calculating stock velocity per SKU, mapping your supplier history, and composing your first Morning Brief. Everything we create comes from your own data — nothing is estimated or fabricated.

**Transition CTA (after 3 seconds):**
> [Takes you automatically to the sync screen]

---

## 7. Sync & Loading States

### 7.1 The Sync Screen — Full Copy System

The sync screen is the most dangerous dead zone in onboarding. A bare spinner loses 30% of new installs to tab-switching and doubt. The sync screen must feel alive, purposeful, and building toward something specific.

**Screen eyebrow:**
> Syncing your rows

**Screen heading:**
> Reading your operation for the first time

**Screen subheading:**
> This usually takes 2–4 minutes. Worth the wait.

**Step-by-step progress display (show real numbers as they appear):**

Each step shows: status icon (pending / active / complete) + title + subtitle explaining what the data is being used for.

| Step | Title (when complete) | Subtitle |
|---|---|---|
| 1 | Orders synced — [X] orders ingested | Calculating margin per order · risk-scoring delays · building your fulfillment queue |
| 2 | Products synced — [X] variants mapped | Assigning LaSyncro identifiers · building inventory ledger · calculating stock velocity |
| 3 | Calculating demand velocity... | Measuring sales rate per SKU · projecting days of stock remaining · identifying restock risks |
| 4 | Building your Morning Brief | Composing today's operational snapshot · identifying what needs attention first |
| 5 | Your operation is ready | Welcome to LaSyncro |

**Teaser copy block (shown during active sync):**
> Merchants using LaSyncro find their first stock-out risk signal within 4 minutes of their operation loading. It's already in your data. We're finding it now.

**Rule:** Never show a progress percentage or animated bar without accompanying text explaining what is being processed. A percentage bar in silence is just anxiety with a number.

---

### 7.2 Sync Edge Case States

**If sync takes longer than 5 minutes:**
> This is taking a little longer than usual — large catalogues need more time. You'll get an email at [email] the moment your operation is ready. You don't need to keep this tab open.

**If sync fails:**
> We couldn't pull all of your data from Shopify this time. [X] orders and [Y] products loaded successfully. We'll retry the remainder automatically — you'll get an email when your full operation is ready. You can start exploring what we have so far.

**If the store has fewer than 50 orders (low data state):**
> Your store is synced. Because you're early in your Shopify journey, some intelligence signals (like demand velocity) will become more accurate as more orders flow through. Here's what we can show you now.

---

### 7.3 General Loading State Copy Principles

Apply these rules to every loading state in the product, not just initial sync:

1. **Always explain what is loading and why.** "Loading..." is never acceptable. "Loading your supplier delivery history..." is.
2. **Show real numbers when available.** "Processing 312 variants" beats "Processing products."
3. **Set time expectations honestly.** "Usually takes 2–4 minutes" is better than "Almost there!" which is a broken promise if it takes 6 minutes.
4. **Give the merchant something to do or read during the wait.** Idle loading is anxiety. Active loading is anticipation.

---

## 8. First Aha Moment

### 8.1 The Welcome Screen — Primary State

The first screen after sync must deliver an insight drawn from the merchant's own data, immediately actionable, within the first 4 minutes of the operation loading. No setup wizard. No empty states. Value first.

**Screen eyebrow:**
> Your operation is synced

**Screen heading:**
> Here's what we found in the first pass.

**Screen subheading:**
> [X] orders · [X] variants · 90 days of history analysed

**Stock-out risk block (lead element, amber/red urgency):**

Heading: Stock-out risk detected
Subheading: [X] SKUs will stock out within [X] days at current velocity

Body: [SKU 1] · [X] days remaining · selling [X] units/day
[SKU 2] · [X] days remaining · selling [X] units/day
[SKU 3] · [X] days remaining · selling [X] units/day

Revenue quantification: £[X] at risk in the next 30 days if these SKUs stock out at current sell rate.

CTA: View restock recommendations →

**Four intelligence cards:**

1. £[X] — Revenue at risk from stock-out SKUs in next 30 days
2. [X] — Orders currently at risk of SLA breach
3. [X]% — Revenue concentration in top [X] customers (LTV flag)
4. [X] days — Average fulfillment time across last 90 days

**Morning Brief hook (bottom of screen):**
> "This is your Morning Brief. Every day, before you start."
> [Set up daily delivery →]

---

### 8.2 Aha Moment Personalisation Logic

The Aha screen must adapt when the primary hook is not relevant:

**If no stock-out risk exists (all SKUs healthy):**
Replace the risk block with a demand velocity insight:
> Your fastest-moving SKU ([SKU name]) is selling [X] units/day. At current stock levels, you have [X] days before reorder is needed. LaSyncro tracks this automatically — you'll see it on your Morning Brief.

**If the store has fewer than 20 orders:**
Replace the risk block with a setup guide framed as unlocking intelligence:
> Your store is connected. To unlock your demand signals and fulfillment intelligence, we need a few more orders to flow through — typically 2–4 weeks of trading. In the meantime, here's what you can set up to be ready.

**If there are held orders (most common and most powerful):**
Lead with held orders as the primary hook, not stock-out risk:
> You have [X] orders on hold waiting for stock that hasn't arrived. Create a purchase order to track the incoming shipment — those orders will auto-release the moment the stock is scanned in.

---

### 8.3 The PO Cascade Confirmation Modal

This modal fires when a PO is fully received and all line items are scanned. It is the most emotionally resonant moment in the entire product. Write it to feel like a superpower being exercised.

**Modal heading:**
> PO #[XXXX] received. Here's what just happened.

**Cascade list (real-time, checks appearing one by one):**
> ✓ Inventory updated — [X] units added across [X] SKUs
> ✓ [X] held customer orders released to fulfilment queue
> ✓ Shopify stock levels synced
> ✓ Stow tasks pushed to [operator name]'s device
> ✓ COGS committed to cash flow model — £[X] posted
> ✓ Demand projections refreshed — [X] SKU restock signals updated

**Closing line:**
> One barcode scan. Six things, automatically.

**CTA:**
> View your updated fulfillment queue →

**Design note:** This modal should not be dismissible immediately. Let the cascade items appear with a 300ms stagger. The animation is not cosmetic — it is the proof that all six things happened. Do not skip it.

---

## 9. In-App Copy System

### 9.1 Empty States

Empty states are the most neglected copy surface in most SaaS products and the highest-leverage copy surface in LaSyncro. Every empty state must do three things: name the absent thing, explain what it unlocks, and give a single clear action.

**Empty state formula:**
> [No X yet] — [What X enables] — [One CTA]

**PO list — empty:**
> No purchase orders yet.
> Create your first PO to start tracking incoming stock, supplier delivery performance, and auto-releasing held orders.
> [Create purchase order]

**Supplier list — empty:**
> No suppliers added yet.
> Add your first supplier to begin tracking on-time rate, fill rate, and delivery performance — automatically, from every PO.
> [Add supplier]

**Warehouse locations — empty:**
> No locations set up yet.
> Create your first warehouse zone and location to enable barcode-based receiving and stow task routing.
> [Set up warehouse]

**Operator roster — empty:**
> No operators invited yet.
> Invite your first operator to unlock mobile pick, pack, and receive sessions.
> [Invite operator]

**Morning Brief — first view, no data yet:**
> Your Morning Brief is being composed. Check back once your first PO has been received and your demand signals have enough data to surface — usually within your first week of trading through LaSyncro.

---

### 9.2 Motivation Hooks — Data Completeness Nudges

These are persistent nudge labels that appear on form fields and in context when a key field is missing. They must always explain the consequence of the missing data, not just flag that it is missing.

| Field | Nudge copy |
|---|---|
| PO expected arrival date | "Add an arrival date to enable delivery alerts and held order auto-release." |
| Product barcode | "Add a barcode to enable scan-receive — your operator can receive this SKU from their phone." |
| Supplier name on PO | "Add the supplier to begin tracking their on-time rate and fill rate." |
| Operator email address | "Add an email to invite this operator to the mobile WMS app." |
| Warehouse location on stow task | "Assign a location to create a scannable stow task for your operator." |

**Rule:** Nudge copy never says "required" or "missing." It always says what the merchant gains by completing the field.

---

### 9.3 Success States

Success states are often ignored in product copy. In LaSyncro they are conversion assets — they prove that the product is working and reinforce the habit.

**PO created:**
> PO #[XXXX] created — [X] line items, [X] units, arriving [date]. Your operator will be notified when it's ready to receive.

**PO received (full):**
> PO #[XXXX] fully received. Inventory updated. [X] held orders released. (See the cascade modal above.)

**PO partially received:**
> [X] of [X] units received for PO #[XXXX]. [X] units still outstanding. LaSyncro will track the remainder when the next delivery arrives.

**Supplier rated for the first time:**
> First delivery from [Supplier] tracked. Their on-time score: [X]%. Their fill rate: [X]%. Every future delivery will build their rating automatically.

**Operator invited:**
> Invitation sent to [email]. Once [name] joins, they'll see their task queue and can begin pick, pack, and receive sessions from their phone.

**Morning Brief set up:**
> Done — your Morning Brief will arrive every morning at [time]. You can change the time or format from your notification settings.

---

### 9.4 Upgrade Prompts — Intelligence Blurring

On Core tier, intelligence features (cash flow projection, demand intelligence, LTV signals) are visible but blurred. The prompt that accompanies the blur is a conversion mechanism, not a gate message.

**Cash flow projection — blurred (Core tier):**
> Your cash flow projection is ready — it's built from your PO history, COGS, and sell-through rate. Upgrade to Growth to see it in full.
> [See what's included in Growth →]

**Demand intelligence — blurred (Core tier):**
> LaSyncro has calculated demand velocity for [X] of your SKUs. [X] are showing restock risk this week. Upgrade to Growth to see which ones.
> [Upgrade to Growth — £179/month]

**Supplier rating intelligence — blurred (Core tier, more than 5 suppliers):**
> You have [X] suppliers rated. [X] have a fill rate below 90%. Upgrade to Growth to see the full rankings and restock recommendations.

**Rule:** Blurred prompts must always state what specific insight is waiting — never "unlock more features." The merchant must be able to imagine what they are missing.

---

### 9.5 Role-Based Copy Differences

**Owner / Admin view language:**
Financial data visible, full operational context, strategic framing.
> "SKU LINEN-GRY-M has 2 days of stock remaining — at £24 COGS per unit and [X] units/day velocity, this represents £[X] in daily revenue at risk."

**Operator view language:**
No financial data, task-first, action-verb-first.
> "Stow 60 units of LINEN-GRY-M in location A-01-2."
> "Pick 3 × WOOL-NVY-L for order #1847."
> "Scan the barcode to confirm."

**Rule:** Operators must never see margin data, COGS, or LTV in any UI state. Not in error messages. Not in success states. Not in tooltips.

---

## 10. Onboarding Email Sequence

### 10.1 Sequence Overview

Six emails across 21 days. Each has one job. Never let one email try to do two jobs — it will do neither well.

| Email | Day | Trigger | Subject | Primary job |
|---|---|---|---|---|
| 1 | 0 | Sync complete | Your operation just loaded. Here's what we found. | Pull back within first hour |
| 2 | 1 | No PO created | The one thing that changes how you receive stock | Drive first PO creation |
| 3 | 3 | No WMS session | Your operator's phone is about to become a warehouse tool | Get operator invited |
| 4 | 7 | Always | What your operation looked like this week | Demonstrate accumulated value |
| 5 | 14 | Always (trial end) | Your Growth trial ends in 3 days | Convert trial to paid |
| 6 | 21 | Always | One question about your first three weeks | Collect testimonial + review |

---

### 10.2 Email 1 — Day 0 — Sync Complete

**Subject:** Your operation just loaded. Here's what we found.

**Preview text:** 3 SKUs at risk. £47,200 in the next 30 days.

**Body:**

Hi [First name],

LaSyncro just finished reading your Shopify store.

Here's the headline: you have [X] SKUs that will stock out within [X] days at current velocity, with roughly £[X] in revenue at stake if they do.

That number was already in your data. LaSyncro just made it visible.

Log in now to see which SKUs they are and what we recommend.

→ [View your stock-out risks]

You'll also see your first Morning Brief — a daily operational snapshot that shows you what needs attention before the day begins. It's ready now.

— The LaSyncro team

P.S. If anything looks off or you have questions, reply to this email. We read every one.

---

**Writing rules for Email 1:**

- The specific revenue number in the subject preview is the only hook that competes with a merchant's inbox — generic "your sync is complete" emails are opened once at 15% and never again
- "That number was already in your data. LaSyncro just made it visible." — keep this sentence exactly as written. It is the most important sentence in the onboarding sequence. It reframes the product from "tool you set up" to "intelligence that was always there waiting."
- P.S. with a direct reply address signals a real person, not an automated system

---

### 10.3 Email 2 — Day 1 — No PO Created

**Subject:** The one thing that changes how you receive stock

**Preview text:** [X] orders on hold. One PO fixes this.

**Body:**

Hi [First name],

You have [X] orders sitting on hold waiting for stock that hasn't arrived yet. Every day they wait is a day a customer isn't happy.

LaSyncro's purchase order flow fixes this. When you create a PO and receive it by barcode scan, those held orders auto-release the moment the stock is confirmed. Your customer gets their order. Your operator gets a stow task. Your inventory updates. All from one scan.

Creating your first PO takes 3 minutes.

→ [Create your first purchase order]

Once it's in, you'll see exactly why merchants say the receive flow is the moment LaSyncro clicked for them.

— The LaSyncro team

---

### 10.4 Email 3 — Day 3 — No WMS Session

**Subject:** Your operator's phone is about to become a warehouse tool

**Preview text:** One invite. One scan. No more clipboards.

**Body:**

Hi [First name],

The fastest way to show LaSyncro's value to your warehouse team is to let them receive a delivery from their phone.

No spreadsheet. No paper checklist. They open LaSyncro, point the camera at a barcode, and the system does the rest — inventory updates, stow task queued, held orders released.

To set this up:

1. Invite your operator from your LaSyncro dashboard
2. They download the LaSyncro app (iOS or Android — free)
3. Next delivery, hand them the phone instead of a clipboard

→ [Invite your first operator]

The first time they scan a box and watch held orders release in real time, your entire team will understand what LaSyncro is for. It takes about 90 seconds to demonstrate.

— The LaSyncro team

---

### 10.5 Email 4 — Day 7 — Weekly Digest

**Subject:** What your operation looked like this week

**Preview text:** [X] orders · [X] stock-out risks avoided · your top supplier.

**Body:**

Hi [First name],

Here's your week in LaSyncro:

- [X] orders fulfilled — avg [X] days to ship
- [X] SKU restock risks surfaced (and [X] acted on)
- Your most reliable supplier this week: [Supplier name] — [X]% on-time
- Pick accuracy across [X] WMS sessions: [X]%

This is a preview of your Morning Brief — the daily operational snapshot that tells you what needs attention before the day begins.

If you haven't set it up yet, it takes 30 seconds.

→ [Set up your Morning Brief]

— The LaSyncro team

---

### 10.6 Email 5 — Day 14 — Trial Conversion

**Subject:** Your Growth trial ends in 3 days

**Preview text:** What you'd keep. What you'd lose. What it costs.

**Body:**

Hi [First name],

Your 14-day Growth trial ends on [date]. After that, you'll move to the free Starter tier unless you choose a plan.

**What you'd lose on Starter:**

- Cash flow projection
- Demand intelligence and stock-out risk signals
- LTV signals and customer concentration alerts
- Unlimited WMS sessions
- Supplier performance ratings

**What Growth costs:** £179/month. Or £143/month on annual billing — two months free.

If LaSyncro has already shown you a stock-out risk you didn't know about, or surfaced a supplier problem before it became a customer complaint, it's paid for itself this month.

→ [Keep Growth — £179/month]
→ [See all plans]

If you're not ready to commit, the free Starter tier stays available — you won't lose your data or your configuration.

— The LaSyncro team

---

**Writing note for Email 5:** "What you'd lose" framing is more effective than "what you'd gain" for trial conversion. Loss aversion is stronger than acquisition desire. The annual billing nudge belongs in this email — this is the moment of highest motivation in the entire sequence.

---

### 10.7 Email 6 — Day 21 — Review + Testimonial

**Subject:** One question about your first three weeks

**Preview text:** Reply to this email. I read every one.

**Body:**

Hi [First name],

Three weeks in. One question:

**What's the first thing LaSyncro showed you that you didn't know before?**

Just reply to this email — I read every one personally. Your answer might end up as a testimonial on the website (with your permission, of course).

— [Founder first name]

P.S. If you have 60 seconds, a review on the Shopify App Store helps other merchants like you find LaSyncro. → [Leave a review] No pressure — your reply to my question is more valuable to me.

---

**Writing note for Email 6:** "What's the first thing LaSyncro showed you that you didn't know before?" is the best testimonial prompt in B2B SaaS. It produces specific, falsifiable, emotionally resonant answers. "Helped me manage inventory better" is a useless testimonial. "I found out three SKUs were four days from stocking out — I had no idea" is a converting testimonial. The prompt drives the specificity.

---

## 11. Lifecycle & Retention Emails

### 11.1 Churn Signal Playbook

| Signal | Threshold | Response |
|---|---|---|
| No login | 7 days | Founder personal email — specific question about their store |
| No PO created | 14 days | Email 2 resend with subject "Still waiting to try the receive flow?" |
| No WMS session | 7 days after first PO | Email 3 resend with subject "Has your operator tried the scan-receive yet?" |
| Downgrade attempted | Immediate | Offer 1 month free on current tier + survey |
| Cancel attempted | Immediate | Surface pause option first — "Pause for up to 3 months instead" |

---

### 11.2 7-Day Inactivity Email

**Subject:** [Store name] — quick question

**Body:**

Hi [First name],

I noticed you haven't logged into LaSyncro in the past week. I wanted to check in directly — is there something specific that isn't working for you, or something I can help set up?

Specifically: did your first stock-out risk signal make sense? Was anything in the setup unclear?

Just reply to this — I'll respond personally.

— [Founder name]

---

### 11.3 Pause Flow Copy

The pause option must be surfaced immediately when a merchant clicks "cancel." It is not a dark pattern — it is a genuine alternative for seasonal businesses and merchants who need to pause, not quit.

**Pause prompt heading:**
> Before you cancel — would a pause work instead?

**Pause prompt body:**
> You can pause your LaSyncro subscription for up to 3 months. Your data, configuration, and warehouse setup stays intact. When you're ready to restart, everything picks up exactly where you left off.
>
> Pausing costs nothing. Cancelling means starting setup from scratch if you come back.

**CTA options:**
> [Pause for 1 month] · [Pause for 3 months] · [Cancel anyway]

---

### 11.4 Weekly Digest Email (ongoing, all paying tiers)

**Subject:** Your [day] Morning Brief — [X] things need your attention

**Body:**

Hi [First name],

Here's what LaSyncro is watching for you this week:

**Stock signals:**
[X] SKUs with less than 7 days of stock at current velocity
[X] SKUs with healthy levels — no action needed

**Purchase orders:**
[X] POs arriving this week
[X] POs overdue from expected arrival

**Supplier performance:**
Best this week: [Supplier] — [X]% on-time, [X]% fill rate
Watch: [Supplier] — [X]% on-time (below your 90% threshold)

**Operations:**
[X] orders fulfilled this week — avg [X] days
[X] pick exceptions logged

→ [Open your full Morning Brief]

— LaSyncro

---

## 12. Pricing Page Copy

### 12.1 Page Heading

> Pricing that grows with your operation

**Subheading:**
> Start free. Upgrade when you're ready. Every plan includes your first 14 days of Growth — the full intelligence tier — at no charge.

---

### 12.2 Tier Copy

**Starter — Free**
> For merchants getting started with operational structure.
> 50 orders/month · 1 operator seat · 3 POs/month · Basic fulfillment queue
> No financial intelligence · No supplier ratings · No demand signals
> *The demand funnel — enough to see what LaSyncro does, not enough to run on permanently.*

**Core — £79/month**
> For merchants who've hired their first warehouse person.
> 500 orders/month · 2 operator seats · 20 POs/month · Full WMS (pick, pack, receive, stow)
> Intelligence features blurred — you can see the shape of your cash flow and demand curves, but not the numbers.
> *The "first warehouse hire" tier — structured workflows, without the full intelligence layer.*

**Growth — £179/month** *(Most merchants end up here)*
> For merchants where intelligence drives the next decision.
> 2,000 orders/month · 5 operator seats · 100 POs/month
> Cash flow projection · Demand intelligence · LTV signals · Supplier ratings (full) · Unlimited WMS sessions
> *Where the product pays for itself. The first prevented stockout covers the month.*

**Scale — £349/month**
> For high-volume operations that need no limits.
> Unlimited orders · Unlimited seats · Unlimited POs
> Floor planning · Barcode generation · Custom DPA · 99.9% SLA · Dedicated support
> *Built for merchants doing £5M+ who need enterprise-grade reliability without enterprise-grade complexity.*

---

### 12.3 Pricing Page FAQ Copy

**Q: What happens at the end of my 14-day Growth trial?**
> You move to the Starter free tier automatically. You won't be charged anything, and your data stays intact. You can upgrade to a paid plan any time from your settings.

**Q: Can I change plans later?**
> Yes — upgrade or downgrade any time. Upgrades take effect immediately. Downgrades take effect at the end of your current billing period.

**Q: Is my data safe if I cancel?**
> Your data is retained for 30 days after cancellation. You can export everything (orders, POs, inventory records, supplier data) as CSV or JSON from your settings. After 30 days, it is cryptographically deleted.

**Q: Do you take a cut of my Shopify revenue?**
> No. LaSyncro charges a flat monthly subscription. We never take a percentage of orders or revenue.

**Q: What's the difference between operator seats and admin seats?**
> Operators access WMS functions only — pick, pack, receive, stow. They cannot see financial data, settings, or supplier intelligence. Admins have full operational access but cannot manage billing or delete the shop. Owners have all permissions.

---

## 13. Error States & Edge Cases

### 13.1 Error Copy Principles

1. **Never blame the merchant.** Errors are never their fault unless they genuinely are — and even then, frame it constructively.
2. **Always explain what happened in plain language.** "Error 503" is not an explanation.
3. **Always give a next step.** An error without a path forward is an anxiety trap.
4. **Be specific about what was lost and what was not.** "Your data is safe" is more useful than a generic apology.

---

### 13.2 Error Message Templates

**Shopify connection lost:**
> We've lost connection to your Shopify store. Your LaSyncro data is safe — we've paused syncing until the connection is restored. This usually resolves itself within a few minutes.
> If it persists: [Reconnect Shopify] or email <hello@lasyncro.com>

**PO receive session interrupted:**
> Your receive session was interrupted before it completed. [X] of [X] units were confirmed — your inventory has been updated for those. The remaining [X] units are still outstanding on PO #[XXXX].
> [Resume receive session] or [Mark as partially received]

**WMS scan — barcode not found:**
> That barcode isn't linked to a product in LaSyncro yet. You can add it now and continue your session, or flag it for your admin to resolve.
> [Add barcode to product] · [Skip this item]

**Payment failed:**
> Your payment didn't go through — your LaSyncro account is still active for 14 days while you update your billing details.
> We haven't interrupted any of your workflows or changed your data.
> [Update billing details]

**Sync timeout:**
> Your sync is taking longer than expected — this sometimes happens with very large catalogues. We're still running it in the background. You'll get an email at [email] the moment it completes. You don't need to keep this tab open.

---

## 14. Social & Content Marketing

### 14.1 LinkedIn Content Pillars

Four content pillars for the LaSyncro founder account. Each serves a different algorithm and audience segment. Post at minimum twice per week — once from pillars 1 or 2, once from pillar 3 or 4.

**Pillar 1 — The Operational Insight**
Specific, actionable intelligence for SMB operators. No product pitch.
> *Example: "Most merchants find out they've stocked out from an angry customer email. By that point, you've lost the sale, the customer trust, and the reorder. The fix isn't faster shipping — it's knowing 4 days before the customer does. Here's how we measure it."*

**Pillar 2 — The 8am Problem Series**
Real, specific scenarios from the daily life of a warehouse merchant. No solution proposed. Just recognition.
> *Example: "It's 7:58am. You have a WhatsApp from a supplier asking about a PO. You have an email from a customer asking about their order. And you have no idea where the November receive spreadsheet is. This is not a failure of effort. It's a failure of infrastructure."*

**Pillar 3 — Behind the Product**
How LaSyncro is built, why certain decisions were made, what merchants asked for. Builds founder credibility.
> *Example: "The name LaSyncro comes from 'Let's Sync Up Your Rows.' Rows as in database rows — every order, every SKU, every supplier record. We wanted a name that meant what the product does. Here's why that matters in B2B..."*

**Pillar 4 — Merchant Wins**
Real outcomes from real merchants (with permission). Specific numbers, named scenarios.
> *Example: "One of our merchants caught a stock-out risk on their best-selling SKU 5 days before it would have happened. They reordered that day. The stockout never happened. That's £12,000 of revenue that would have evaporated. Their words: 'I had no idea. LaSyncro showed me in the first session.'"*

---

### 14.2 Content SEO Targets

Long-form content (1,500+ words) targeting merchants searching for operational solutions. Each article should be written before the merchant knows they need LaSyncro — they are solving a problem, not searching for software.

| Article title | Search intent | LaSyncro angle |
|---|---|---|
| "How to know when to reorder stock (before you run out)" | Stockout prevention | Demand velocity methodology |
| "Why your warehouse spreadsheet is costing you money" | Spreadsheet pain | Single source of truth |
| "How to measure supplier reliability without manual tracking" | Supplier management | Automatic supplier ratings |
| "What is a WMS and does your Shopify store need one?" | WMS education | LaSyncro as the accessible entry |
| "The morning routine every warehouse merchant needs" | Operations improvement | Morning Brief concept |
| "How to manage purchase orders for a Shopify store" | PO management | LaSyncro PO module |
| "What does a pick and pack process actually look like?" | WMS education | Operator workflow |

---

### 14.3 The Founding Story — When to Use It

The name origin ("Let's Sync Up Your Rows") is a founding story that can be deployed strategically in three contexts:

1. **Investor conversations** — shows thoughtfulness, brand depth, and product-naming intentionality
2. **Press and podcast pitches** — journalists and podcast hosts love a name with a story; it becomes the hook for the piece
3. **Merchant community content** — "here's why we called it LaSyncro" is a genuine community post that builds brand affinity without selling

**What to say:**
> "LaSyncro comes from 'Let's Sync Up Your Rows.' Rows as in database rows — every order line, every inventory record, every supplier delivery. We wanted a name that described exactly what the product does: taking every row of your operation and making them talk to each other for the first time. That's what LaSyncro means. That's what it does."

---

## 15. Copy QA Checklist

Apply this checklist to every piece of copy before it is published, deployed, or sent.

### 15.1 Voice & Tone

- [ ] Does it sound like a trusted advisor, not a SaaS marketing team?
- [ ] Are there any words from the "Avoid" list present?
- [ ] Is the tone calibrated correctly for the context (see tone modulation table)?
- [ ] Could a competitor say this without changing a word? If yes, rewrite.

### 15.2 Message Architecture

- [ ] Does this copy serve one of the four voice pillars (Operational, Honest, Warm, Precise)?
- [ ] Is the primary message an outcome, not a feature?
- [ ] Is every claim specific and falsifiable?
- [ ] Does it fit within the master narrative arc (validation → diagnosis → resolution)?

### 15.3 ICP Alignment

- [ ] Would the 8am merchant read this and feel understood?
- [ ] Does the copy exclude wrong-fit audiences (dropshippers, 3PLs, enterprise-only) without alienating them?
- [ ] Is the ICP qualifier present where appropriate?

### 15.4 Conversion Mechanics

- [ ] Is the primary CTA singular? (No "or try X or see Y" — one action per screen)
- [ ] Is the value delivered before the ask?
- [ ] Are any upgrade prompts specific about what is behind the gate?
- [ ] Is the trust layer present (data safety, reversibility, no hidden charges)?

### 15.5 Email-Specific

- [ ] Does the subject line contain a specific number or outcome?
- [ ] Does the preview text complement the subject (no repetition)?
- [ ] Does the email have one job and one CTA?
- [ ] Is the P.S. present where appropriate? (P.S. lines have 90% read rates)

### 15.6 In-App Specific

- [ ] Does every empty state name the absent thing, explain what it unlocks, and give one action?
- [ ] Does every error state explain what happened, confirm what was preserved, and give a next step?
- [ ] Does every success state show the downstream consequences, not just confirm the action?
- [ ] Is all operator-facing copy action-verb-first and free of financial data?

### 15.7 Brand Signature

- [ ] Does "syncs up every row" or "let's sync up every row" appear at least once on the page/email/screen where appropriate?
- [ ] Is the name written as "LaSyncro" (capital L, capital S) consistently throughout?
- [ ] Are all numbers rounded and real (no made-up metrics or placeholder figures)?

---

## Appendix A — Quick Reference Card

**The master claim:**
> LaSyncro is the operational central nervous system for SMB commerce.

**The brand line:**
> Let's sync up every row.

**The 8am hook (first paragraph, never change):**
> It's 8am. Three customer emails about delayed orders sit unanswered...

**The emotional release line (never change):**
> This is not a failure of effort. This is a failure of infrastructure.

**The Aha insight reframe (Email 1, never change):**
> That number was already in your data. LaSyncro just made it visible.

**The cascade payoff line (PO modal, never change):**
> One barcode scan. Six things, automatically.

**The ICP qualifier:**
> LaSyncro is built for Shopify merchants doing serious volume from their own warehouse — typically £500K to £10M+ in revenue, with high SKU complexity and a small warehouse team.

**The pricing ROI anchor:**
> At £179/month, LaSyncro costs less per day than a single unplanned stockout costs in lost revenue.

---

## Appendix B — Version Control

| Version | Date | Author | Changes |
|---|---|---|---|
| 1.0 | April 2026 | Founding Team | Initial production release |

---

*LaSyncro Copy & Content Strategy Blueprint — Version 1.0*
*For internal use. Review before any major copy update or new surface launch.*
*Contact: <hello@lasyncro.com>*
