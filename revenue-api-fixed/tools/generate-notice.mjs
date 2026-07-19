import 'dotenv/config'
import { getDb, closeDb } from '../src/db.js'
import { generateNoticePDF } from '../src/services/pdf.js'

const noticeId = Number(process.argv[2] || 3)
const sql = getDb()

const [n] = await sql`
  SELECT
    dn.notice_id, dn.notice_number, dn.amount_due, dn.issued_date, dn.due_date, dn.record_id,
    tr.taxpayer_name, tr.taxpayer_phone, tr.taxpayer_email, tr.taxpayer_id_no,
    z.zone_name,
    rt.type_name AS record_type
  FROM demand_notice dn
  JOIN taxpayer_record tr USING (record_id)
  JOIN zone z ON z.zone_id = tr.zone_id
  JOIN record_type rt ON rt.record_type_id = tr.record_type_id
  WHERE dn.notice_id = ${noticeId}
`

if (!n) {
  console.error('Notice not found:', noticeId)
  await closeDb()
  process.exit(1)
}

try {
  console.log(`Generating PDF for ${n.noticeNumber} (id=${n.noticeId})...`)
  const pdfPath = await generateNoticePDF({
    ...n,
    countyName: process.env.COUNTY_NAME,
    lineItems: [{ description: `${n.recordType} levy`, amount: Number(n.amountDue) || 0 }],
  })
  await sql`UPDATE demand_notice SET pdf_path = ${pdfPath} WHERE notice_id = ${n.noticeId}`
  console.log('OK ->', pdfPath)
} catch (err) {
  console.error('FAILED:', err && err.message)
  console.error(err && err.stack)
} finally {
  await closeDb()
}
