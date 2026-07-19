// Manually generate PDFs for notices that are missing pdf_path
import 'dotenv/config'
import { getDb, closeDb } from './src/db.js'
import { generateNoticePDF } from './src/services/pdf.js'

const sql = getDb()

const missing = await sql`
  SELECT
    dn.notice_id, dn.notice_number, dn.amount_due, dn.issued_date, dn.due_date,
    tr.taxpayer_name, tr.taxpayer_phone, tr.taxpayer_email, tr.taxpayer_id_no,
    z.zone_name,
    rt.type_name AS record_type
  FROM demand_notice dn
  JOIN taxpayer_record tr USING (record_id)
  JOIN zone z ON z.zone_id = tr.zone_id
  JOIN record_type rt ON rt.record_type_id = tr.record_type_id
  WHERE dn.pdf_path IS NULL
  ORDER BY dn.notice_id
`

console.log(`Found ${missing.length} notice(s) without a PDF`)

for (const n of missing) {
  try {
    console.log(`\nGenerating PDF for ${n.noticeNumber} (id=${n.noticeId})...`)
    const pdfPath = await generateNoticePDF({
      ...n,
      countyName: process.env.COUNTY_NAME,
      lineItems: [{
        description: `${n.recordType} levy`,
        amount: Number(n.amountDue) || 0,
      }],
    })
    await sql`UPDATE demand_notice SET pdf_path = ${pdfPath} WHERE notice_id = ${n.noticeId}`
    console.log(`  OK -> ${pdfPath}`)
  } catch (err) {
    console.error(`  FAILED for ${n.noticeNumber}:`, err.message)
    console.error(err.stack)
  }
}

await closeDb()
