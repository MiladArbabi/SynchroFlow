# **Packing & Shipping (Verify Before Dispatch)**

---

## 1. What Packing & Shipping Means in LaSyncro

Packing is the final verification step before an order leaves your warehouse.
Every item is scanned. Every shipment is confirmed automatically.
No order selection. No batch claiming. Just scan.

---

## 2. What You Need Before You Start

- Items already picked, placed in a roller bin at the packing station
- Packing station ready (box/bag, tape, packing materials)
- LaSyncro open on the packing station device
- Invoice printer (A4) and label printer connected and online

---

## 3. How Pack Mode Works

Open **Warehouse → Operations**. The **Pack mode** panel is always active at the top of the page — a pulsing scan input listening for any LSU- unit barcode.

There is no batch to claim. There is no order to select.
Grab any item from the bin. Scan its unit barcode (LSU-XXXXXXXX).

---

## 4. The Flow
Scan LSU- → order opens → invoice + label print automatically
→ scan remaining sibling LSU- codes (multi-item orders)
→ scan LSO- invoice barcode → shipped → next item

---

## 5. Step-by-Step

### Step 1 — Grab any item and scan it

Reach into the bin. Grab any item. Scan the LSU- unit barcode on its label.

The screen instantly shows:
- Product image and variant
- Which order it belongs to (order number, customer name, shipping address)
- All other items in the same order (sibling thumbnails with scan status)

---

### Step 2 — Invoice and shipping label print automatically

As soon as the first LSU- scan resolves for an order:
→ The invoice (A4) prints at the invoice printer
→ The shipping label prints at the label printer

You do not tap anything. This is automatic.

**If the printer is offline:** a warning banner appears — you can still proceed. The print job re-queues and can be triggered manually. Do not hold up the session waiting for the printer.

---

### Step 3 — Scan sibling items (multi-item orders only)

If the order has more than one item, the screen shows all siblings with pending indicators.
Scan each sibling's LSU- barcode. Each confirmed scan flips to a green check.

The LSO- confirmation step is locked until all siblings are scanned.

---

### Step 4 — Scan the invoice barcode to confirm shipment

The printed invoice has an LSO- barcode printed on it. Scan it.

What happens instantly:
→ Order status → shipped in LaSyncro
→ All inventory units for this order → shipped
→ Shopify order → fulfilled
→ Customer receives shipping confirmation email
→ Pack mode clears and returns to listening

---

### Step 5 — Pack and dispatch

- Place all items in the box or bag together with the invoice
- Seal the parcel
- Attach the printed shipping label to the outside
- Place on the dispatch shelf or conveyor

---

### Step 6 — Repeat

Pack mode is immediately ready for the next LSU- scan.
Work through the bin until it is empty.

When the last order in the batch is confirmed, the batch closes automatically.
A brief notification confirms closure — there is no redirect, no summary screen.

---

## 6. Exceptions — What to Do When Something Is Wrong

Use the **Report a problem** button on the pack session screen at any point.

| Exception | Meaning | What happens |
|---|---|---|
| Item missing at pack | Expected item is not in the bin | Owner notified — must approve/reject before you can advance |
| Short pick | Fewer units than expected | Same owner approval flow |
| Product defect | Item is damaged or faulty | Goes to Problem Center. You advance immediately |
| Packaging defect | Packaging is damaged | Goes to Problem Center. You advance immediately |
| Wrong item | Item in bin does not match this order | Goes to Problem Center. You advance immediately |

**Abandoning a multi-item session:** If you tap ← Pack mode before all siblings are confirmed, the system asks you to confirm. Session state is not saved — you will need to re-scan all items for that order on return.

---

## 7. When Pack Mode Rejects a Scan

If a scanned LSU- barcode is not packable, the reason appears inline below the scan bar. The error clears automatically after a few seconds and pack mode returns to listening.

| Rejection reason | What to do |
|---|---|
| Item not yet picked — batch still in picking | Wait for pick to complete, or escalate via Problem Center |
| Item already packed | Unit was confirmed in a prior session — check for duplicate |
| Unit not recognised | Barcode may be damaged or belong to a different shop — escalate |

**LSO- mismatch:** If you accidentally scan an invoice barcode that does not match the open session, it is rejected with a clear error. Never silently accepts the wrong invoice.

---

## 8. Why This Step Is Critical

This is the last moment to catch errors before they reach the customer.
A wrong item shipped = a return, a refund, a lost customer.
The scan is your proof that the right item left the building.

---

## 9. Common Mistakes to Avoid

- Scanning without packing — the system records shipment confirmation; the item must physically leave with the parcel
- Skipping the LSO- invoice scan — the order stays open in Shopify, the customer receives no confirmation email
- Abandoning a multi-item session mid-way — the scanned items are not persisted; re-scan on return

---

## 10. Where to Go Next

After all parcels are dispatched:
→ **Returns & Refunds (Handling What Comes Back)**