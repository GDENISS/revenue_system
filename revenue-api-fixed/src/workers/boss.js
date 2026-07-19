// src/workers/boss.js
import PgBoss from 'pg-boss'
import { getDb } from '../db.js'
import { generateNoticePDF } from '../services/pdf.js'
import { syncArcGIS } from '../services/arcgis-sync.js'

let boss

export async function startWorkers(app) {
  boss = new PgBoss({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    deleteAfterDays: 7,
    archiveCompletedAfterSeconds: 3600,
    monitorStateIntervalSeconds: 30,
  })

  boss.on('error', (err) => app.log.error({ err }, 'pg-boss error'))

  await boss.start()

  // ── Worker: generate-notices ────────────────────────────────────────────
  await boss.work('generate-notices', { teamSize: 3, teamConcurrency: 3 }, async ([job]) => {
    const { noticeIds } = job.data
    const sql = getDb()

    app.log.info(`Processing bulk PDF generation for ${noticeIds.length} notices`)

    for (const noticeId of noticeIds) {
      try {
        const [notice] = await sql`
          SELECT
            dn.notice_id,
            dn.notice_number,
            dn.amount_due,
            dn.issued_date,
            dn.due_date,
            tr.taxpayer_name,
            tr.taxpayer_phone,
            z.zone_name,
            rt.type_name AS record_type
          FROM demand_notice dn
          JOIN taxpayer_record tr USING (record_id)
          JOIN zone z ON z.zone_id = tr.zone_id
          JOIN record_type rt ON rt.record_type_id = tr.record_type_id
          WHERE dn.notice_id = ${noticeId}
        `

        if (!notice) continue

        const pdfPath = await generateNoticePDF({
          ...notice,
          countyName: process.env.COUNTY_NAME,
        })

        await sql`UPDATE demand_notice SET pdf_path = ${pdfPath} WHERE notice_id = ${noticeId}`
        app.log.debug(`PDF generated for notice ${notice.noticeNumber}`)
      } catch (err) {
        app.log.error({ err, noticeId }, 'Failed to generate PDF for notice')
      }
    }

    app.log.info(`Bulk PDF generation complete for batch of ${noticeIds.length}`)
  })

  // ── Worker: arcgis-manual-sync ──────────────────────────────────────────
  await boss.work('arcgis-manual-sync', async () => {
    await syncArcGIS(app.log)
  })

  app.log.info('Workers registered: generate-notices, arcgis-manual-sync')

  // Clean up on app close
  app.addHook('onClose', async () => {
    await boss.stop()
  })

  return boss
}

/**
 * Queue a bulk PDF generation job
 */
export async function queuePDFGeneration(noticeIds) {
  if (!boss) throw new Error('Job queue not initialized')
  return boss.send('generate-notices', { noticeIds }, { priority: 5 })
}

/**
 * Queue a manual ArcGIS sync
 */
export async function queueArcGISSync() {
  if (!boss) throw new Error('Job queue not initialized')
  return boss.send('arcgis-manual-sync', {}, { singletonKey: 'arcgis-sync' })
}
