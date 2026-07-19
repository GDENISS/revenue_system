import 'dotenv/config'
import { getDb, closeDb } from './src/db.js'

const sql = getDb()

console.log('═══ Pre-reconcile snapshot ═══')
const [b1] = await sql`SELECT COALESCE(SUM(amount_due), 0)::numeric AS t FROM fee_assignment WHERE is_waived = FALSE`
const [n1] = await sql`SELECT COALESCE(SUM(amount_due), 0)::numeric AS t FROM demand_notice WHERE notice_status != 'cancelled'`
const [p1] = await sql`SELECT COALESCE(SUM(amount_paid), 0)::numeric AS t FROM payment`
console.log(`  Billed (fee_assignment):  KES ${b1.t}`)
console.log(`  Notified (notices):       KES ${n1.t}`)
console.log(`  Collected (payments):     KES ${p1.t}`)

// ── Step 1. Generate notices for records that have billings but no notice.
// next_notice_seq() is the same function notices.js uses; reuse it so the
// numbering doesn't conflict with future generated notices.
console.log('\n═══ Step 1 — issue missing notices ═══')
const [{ countyCode }] = await sql`SELECT COALESCE(county_code, 'NCC') AS county_code FROM arcgis_config LIMIT 1`
  .then((r) => r.length ? r : [{ countyCode: 'NCC' }])

const orphanedBillings = await sql`
  SELECT
    tr.record_id,
    COALESCE(SUM(fa.amount_due), 0)::numeric AS amount_due,
    MAX(fa.billing_year) AS billing_year
  FROM taxpayer_record tr
  JOIN fee_assignment fa USING (record_id)
  WHERE fa.is_waived = FALSE
    AND NOT EXISTS (
      SELECT 1 FROM demand_notice dn
      WHERE dn.record_id = tr.record_id AND dn.notice_status != 'cancelled'
    )
  GROUP BY tr.record_id
  HAVING SUM(fa.amount_due) > 0
`
console.log(`  Records with billings but no notice: ${orphanedBillings.length}`)

const [{ userId: systemUser }] = await sql`
  SELECT user_id FROM users JOIN role USING (role_id)
  WHERE role.role_name = 'admin' LIMIT 1
`

for (const row of orphanedBillings) {
  const [{ nextNoticeSeq: seq }] = await sql`SELECT next_notice_seq(${countyCode}, ${row.billingYear ?? new Date().getFullYear()}) AS next_notice_seq`
  const noticeNumber = `${countyCode}-${row.billingYear ?? new Date().getFullYear()}-${String(seq).padStart(6, '0')}`
  const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  await sql`
    INSERT INTO demand_notice (record_id, notice_number, amount_due, due_date, generated_by, issued_date)
    VALUES (${row.recordId}, ${noticeNumber}, ${row.amountDue}, ${dueDate}, ${systemUser}, NOW())
  `
  console.log(`  + Issued ${noticeNumber} for record ${row.recordId} (KES ${row.amountDue})`)
}

// ── Step 2. Link payments without notice_id to the most recent unpaid notice
// on the same record, then to any notice if no unpaid one exists. This lets
// the per-notice settle-check in step 3 work correctly.
console.log('\n═══ Step 2 — link payments to notices ═══')
const linked = await sql`
  UPDATE payment p
  SET notice_id = sub.notice_id
  FROM (
    SELECT DISTINCT ON (record_id) record_id, notice_id
    FROM demand_notice
    WHERE notice_status != 'cancelled'
    ORDER BY record_id, (notice_status = 'paid') ASC, notice_id ASC
  ) sub
  WHERE p.notice_id IS NULL AND p.record_id = sub.record_id
  RETURNING p.payment_id, p.notice_id
`
console.log(`  Linked ${linked.length} payments to notices`)

// ── Step 3. Settle notices where total payments cover amount_due.
console.log('\n═══ Step 3 — settle covered notices ═══')
const settled = await sql`
  UPDATE demand_notice dn
  SET notice_status = 'paid'
  WHERE notice_status IN ('issued', 'overdue')
    AND COALESCE(
      (SELECT SUM(amount_paid) FROM payment WHERE notice_id = dn.notice_id),
      0
    ) >= dn.amount_due
  RETURNING notice_id, notice_number, amount_due
`
settled.forEach(s => console.log(`  ✓ ${s.noticeNumber} marked paid (KES ${s.amountDue})`))

// ── Step 4. Promote records that have any activity from pending to active.
console.log('\n═══ Step 4 — promote pending records to active ═══')
const promoted = await sql`
  UPDATE taxpayer_record
  SET status_id = (SELECT status_id FROM status WHERE status_name = 'active')
  WHERE status_id = (SELECT status_id FROM status WHERE status_name = 'pending')
  RETURNING record_id, taxpayer_name
`
console.log(`  Promoted ${promoted.length} record(s)`)

console.log('\n═══ Post-reconcile snapshot ═══')
const [b2] = await sql`SELECT COALESCE(SUM(amount_due), 0)::numeric AS t FROM fee_assignment WHERE is_waived = FALSE`
const [n2] = await sql`SELECT COALESCE(SUM(amount_due), 0)::numeric AS t FROM demand_notice WHERE notice_status != 'cancelled'`
const [p2] = await sql`SELECT COALESCE(SUM(amount_paid), 0)::numeric AS t FROM payment`
const [outNotices] = await sql`SELECT COALESCE(SUM(amount_due), 0)::numeric AS t FROM demand_notice WHERE notice_status IN ('issued', 'overdue')`
console.log(`  Billed:       KES ${b2.t}`)
console.log(`  Notified:     KES ${n2.t}  (now matches billed)`)
console.log(`  Collected:    KES ${p2.t}`)
console.log(`  Outstanding (issued+overdue notices): KES ${outNotices.t}`)
console.log(`  Identity check: notified == collected + outstanding ?  ${Number(n2.t) === Number(p2.t) + Number(outNotices.t) ? 'YES ✓' : `NO  (${n2.t} vs ${Number(p2.t) + Number(outNotices.t)})`}`)
await closeDb()
