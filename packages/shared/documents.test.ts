import assert from "node:assert/strict"
import { test } from "node:test"

import { extractFields, findDates, parseAmount } from "./documents.ts"

test("extractFields", () => {
  const eq = (a: unknown, b: unknown, msg: string) => assert.deepEqual(a, b, msg)

  // Dates
  eq(findDates("Invoice date: 2025-03-14")[0].date, "2025-03-14", "iso")
  eq(findDates("14.03.2025")[0].date, "2025-03-14", "dotted day-first")
  eq(findDates("03/14/2025")[0].date, "2025-03-14", "slash month-first when day above 12")
  eq(findDates("03/04/2025")[0].date, "2025-04-03", "ambiguous reads day-first")
  eq(findDates("14 March 2025")[0].date, "2025-03-14", "day month name")
  eq(findDates("March 14, 2025")[0].date, "2025-03-14", "month name day")
  eq(findDates("14-Mar-2025")[0].date, "2025-03-14", "dashed month name")
  eq(findDates("31.02.2025").length, 0, "impossible date skipped")
  eq(findDates("Expires: 01/12/2027")[0].expiry, true, "expiry label")

  // Amounts
  eq(parseAmount("1,234.56"), 1234.56, "us")
  eq(parseAmount("1.234,56"), 1234.56, "eu")
  eq(parseAmount("12,50"), 12.5, "comma decimal")
  eq(parseAmount("1,234"), 1234, "thousands only")
  eq(parseAmount("1 234,50"), 1234.5, "space thousands")

  // Receipt
  const receipt = extractFields(
    "FRESH MARKET\n12 High Street\nRECEIPT\n14/03/2025 10:22\nMilk 1.20\nBread 2.30\nSubtotal 3.50\nVAT 0.70\nTotal $4.20\nVisa ****1234\nThank you for your purchase",
    "IMG_2031.jpg"
  )
  eq(receipt.type, "receipt", "receipt type")
  eq(receipt.amount, 4.2, "receipt total")
  eq(receipt.currency, "USD", "receipt currency")
  eq(receipt.date, "2025-03-14", "receipt date")
  eq(receipt.senderName, "FRESH MARKET", "receipt sender")

  // Invoice with a due date and a European amount
  const invoice = extractFields(
    "ACME GmbH\nInvoice No 4711\nInvoice date: 01.02.2025\nBill to: Jane Doe\nSubtotal 1.000,00 €\nVAT 190,00 €\nTotal 1.190,00 €\nPayment due: 15.02.2025",
    "scan.pdf"
  )
  eq(invoice.type, "invoice", "invoice type")
  eq(invoice.amount, 1190, "invoice total")
  eq(invoice.currency, "EUR", "invoice currency")
  eq(invoice.date, "2025-02-01", "invoice date")
  eq(invoice.expiry, "2025-02-15", "due date is the expiry")

  // ID scan: expiry and type
  const id = extractFields("PASSPORT\nSurname DOE\nGiven names JANE\nDate of birth 04 JUL 1990\nDate of expiry 12 MAY 2031", "passport.jpg")
  eq(id.type, "id", "id type")
  eq(id.senderName, null, "a title is not a sender")
  eq(id.expiry, "2031-05-12", "id expiry")

  // Known senders match by name or pattern, in the text or the file name
  const known = [{ id: "s1", name: "Vodafone", patterns: ["vf bill"] }]
  const bill = extractFields("Your mobile bill\nAmount due £32.10\nDue date 03 Apr 2025\nVF Bill ref 1", "x.pdf", known)
  eq(bill.senderId, "s1", "known sender by pattern")
  eq(bill.type, "bill", "bill type")
  eq(bill.amount, 32.1, "bill amount")
  eq(bill.currency, "GBP", "bill currency")
  eq(extractFields("Vodafone Mobile bill Billing period 01.10.2026 Amount due: 32.10 GBP", "x.pdf").senderName, "Vodafone", "sender from flat PDF text")
  eq(extractFields("RECEIPT\nBread 2.30\nSubtotal 3.50\nVisa paid", "r.jpg").amount, null, "a subtotal alone is not a total")
  eq(extractFields("hello world", "notes.txt").confidence, 0, "nothing found")
})
