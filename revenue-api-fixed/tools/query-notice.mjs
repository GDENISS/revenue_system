import 'dotenv/config'
import { getDb, closeDb } from '../src/db.js'

const noticeId = process.argv[2] || 3
const sql = getDb()

const rows = await sql`SELECT notice_id, notice_number, pdf_path FROM demand_notice WHERE notice_id = ${Number(noticeId)}`
console.log(JSON.stringify(rows, null, 2))

await closeDb()
