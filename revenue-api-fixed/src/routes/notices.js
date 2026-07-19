// src/routes/notices.js
import { getDb } from '../db.js'
import { generateNoticePDF } from '../services/pdf.js'
import { queuePDFGeneration } from '../workers/boss.js'

export default async function noticeRoutes(fastify) {
  const sql = getDb()

  // GET /api/notices — list notices
  fastify.get('/', {
    preHandler: fastify.authenticate,
    schema: {
      querystring: {
        type: 'object',
        properties: {
          page:       { type: 'integer', minimum: 1, default: 1 },
          limit:      { type: 'integer', minimum: 1, maximum: 200, default: 50 },
          recordId:   { type: 'integer' },
          status:     { type: 'string' },
          zoneId:     { type: 'integer' },
        },
      },
    },
  }, async (request) => {
    const { page = 1, limit = 50, recordId, status, zoneId } = request.query
    const offset = (page - 1) * limit

    const notices = await sql`
      SELECT
        dn.*,
        tr.taxpayer_name,
        tr.taxpayer_phone,
        z.zone_name,
        u.name AS generated_by_name
      FROM demand_notice dn
      JOIN taxpayer_record tr USING (record_id)
      JOIN zone z ON z.zone_id = tr.zone_id
      LEFT JOIN users u ON u.user_id = dn.generated_by
      WHERE
        (${recordId ?? null}::int IS NULL OR dn.record_id = ${recordId ?? null})
        AND (${status ?? null}::text IS NULL OR dn.notice_status = ${status ?? null})
        AND (${zoneId ?? null}::int IS NULL OR tr.zone_id = ${zoneId ?? null})
      ORDER BY dn.issued_date DESC
      LIMIT ${limit} OFFSET ${offset}
    `

    const [{ total }] = await sql`
      SELECT COUNT(*)::int AS total
      FROM demand_notice dn
      JOIN taxpayer_record tr USING (record_id)
      WHERE
        (${recordId ?? null}::int IS NULL OR dn.record_id = ${recordId ?? null})
        AND (${status ?? null}::text IS NULL OR dn.notice_status = ${status ?? null})
        AND (${zoneId ?? null}::int IS NULL OR tr.zone_id = ${zoneId ?? null})
    `

    return { data: notices, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } }
  })

  // POST /api/notices/generate — generate notice for one record
  fastify.post('/generate', {
    preHandler: fastify.requireRole('admin', 'finance_manager'),
    schema: {
      body: {
        type: 'object',
        required: ['recordId', 'dueDate'],
        properties: {
          recordId:      { type: 'integer' },
          assignmentId:  { type: 'integer' },
          dueDate:       { type: 'string', format: 'date' },
        },
      },
    },
  }, async (request, reply) => {
    const { recordId, assignmentId, dueDate } = request.body
    const { userId } = request.user

    // Get record + outstanding amount + county metadata for the PDF
    const [record] = await sql`
      SELECT
        tr.record_id,
        tr.taxpayer_name,
        tr.taxpayer_phone,
        tr.taxpayer_email,
        tr.taxpayer_id_no,
        tr.arcgis_object_id,
        z.zone_name,
        rt.type_name AS record_type
      FROM taxpayer_record tr
      JOIN zone z USING (zone_id)
      JOIN record_type rt USING (record_type_id)
      WHERE tr.record_id = ${recordId}
    `
    const [countyMeta] = await sql`
      SELECT
        COALESCE(county_code, 'NCC')                                        AS county_code,
        COALESCE(county_name, 'County Government')                          AS county_name,
        COALESCE(county_address, 'County Treasury Office')                  AS county_address,
        COALESCE(legal_basis, 'Issued under the relevant Rating Act')       AS legal_basis,
        COALESCE(currency_code, 'KES')                                      AS currency_code,
        COALESCE(verify_base_url, '')                                       AS verify_base_url
      FROM arcgis_config LIMIT 1
    `.then((r) => r.length ? r : [{
      countyCode: 'NCC', countyName: 'County Government',
      countyAddress: 'County Treasury Office',
      legalBasis: 'Issued under the relevant Rating Act',
      currencyCode: 'KES', verifyBaseUrl: '',
    }])
    const [officer] = await sql`
      SELECT u.name AS officer_name, u.user_id AS officer_id,
             r.role_name AS officer_role
      FROM users u JOIN role r USING (role_id)
      WHERE u.user_id = ${userId}
    `

    if (!record) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Record not found' })

    // Calculate outstanding amount = unwaived fees - payments
    const [{ amountDue }] = await sql`
      SELECT (
        COALESCE((
          SELECT SUM(fa.amount_due)
          FROM fee_assignment fa
          WHERE fa.record_id = ${recordId}
            AND fa.is_waived = FALSE
            AND (${assignmentId ?? null}::int IS NULL OR fa.assignment_id = ${assignmentId ?? null})
        ), 0)
        - COALESCE((
          SELECT SUM(p.amount_paid)
          FROM payment p
          WHERE p.record_id = ${recordId}
        ), 0)
      )::numeric AS amount_due
    `

    if (Number(amountDue) <= 0) {
      // Explain the root cause: no fees assigned at all vs everything paid.
      const [{ feeCount }] = await sql`
        SELECT COUNT(*)::int AS fee_count
        FROM fee_assignment
        WHERE record_id = ${recordId} AND is_waived = FALSE
      `
      const message = feeCount === 0
        ? 'This record has no fee assignments. Define a fee schedule for its record type/zone (Fees page), assign it, then generate the notice.'
        : 'All assigned fees on this record are already fully paid — there is nothing outstanding to bill.'
      return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message })
    }

    // Notice number: [COUNTY]-[YEAR]-[SEQUENCE] (matches the Nairobi template)
    const year = new Date().getFullYear()
    const [{ countyCode }] = await sql`
      SELECT COALESCE(county_code, 'NCC') AS county_code FROM arcgis_config LIMIT 1
    `.then((r) => r.length ? r : [{ countyCode: 'NCC' }])
    const [{ nextNoticeSeq: seq }] = await sql`
      SELECT next_notice_seq(${countyCode}, ${year}) AS next_notice_seq
    `
    const noticeNumber = `${countyCode}-${year}-${String(seq).padStart(6, '0')}`

    const [notice] = await sql`
      INSERT INTO demand_notice (record_id, assignment_id, notice_number, amount_due, due_date, generated_by)
      VALUES (${recordId}, ${assignmentId ?? null}, ${noticeNumber}, ${amountDue}, ${dueDate}, ${userId})
      RETURNING notice_id, notice_number, amount_due
    `

    // Pull the matching fee assignments (unwaived) to render as line items.
    // Fall back to a single line if nothing has been formally assigned yet.
    const feeRows = await sql`
      SELECT fs.schedule_name, fs.amount, fa.billing_year
      FROM fee_assignment fa
      JOIN fee_schedule fs USING (schedule_id)
      WHERE fa.record_id = ${recordId} AND fa.is_waived = FALSE
    `

    const lineItems = feeRows.length
      ? feeRows.map((f) => ({
          description: `${f.scheduleName} — FY ${f.billingYear}/${(f.billingYear + 1).toString().slice(2)}`,
          amount: Number(f.amount) || 0,
        }))
      : [{
          description: `${record.recordType} levy — ${year}`,
          amount: Number(amountDue) || 0,
        }]

    // Generate PDF in background (non-blocking)
    generateNoticePDF({
      ...notice,
      ...record,
      ...countyMeta,
      dueDate,
      issuedDate: new Date().toISOString(),
      lineItems,
      officerName: officer?.officerName ?? 'Revenue Officer',
      officerId: officer?.officerId ? `${countyMeta.countyCode}/REV/${String(officer.officerId).padStart(4, '0')}` : '—',
      officerDesignation: officer?.officerRole === 'admin'
        ? 'Administrator'
        : officer?.officerRole === 'finance_manager'
          ? 'Finance Manager'
          : 'Revenue Officer',
    })
      .then(async (pdfPath) => {
        await sql`UPDATE demand_notice SET pdf_path = ${pdfPath} WHERE notice_id = ${notice.noticeId}`
      })
      .catch((err) => fastify.log.error({ err }, 'PDF generation failed'))

    await sql`
      INSERT INTO audit_log (user_id, action, table_name, record_id, new_values, ip_address)
      VALUES (${userId}, 'GENERATE_NOTICE', 'demand_notice', ${notice.noticeId}, ${JSON.stringify({ recordId, noticeNumber })}, ${request.ip}::inet)
    `

    return reply.status(201).send({
      noticeId: notice.noticeId,
      noticeNumber: notice.noticeNumber,
      amountDue: notice.amountDue,
      message: 'Notice generated. PDF will be ready shortly.',
    })
  })

  // POST /api/notices/bulk — bulk generate notices for a zone
  fastify.post('/bulk', {
    preHandler: fastify.requireRole('admin', 'finance_manager'),
    schema: {
      body: {
        type: 'object',
        required: ['zoneId', 'billingYear', 'dueDate'],
        properties: {
          zoneId:        { type: 'integer' },
          billingYear:   { type: 'integer' },
          dueDate:       { type: 'string', format: 'date' },
          recordTypeId:  { type: 'integer' },
        },
      },
    },
  }, async (request, reply) => {
    const { zoneId, billingYear, dueDate, recordTypeId } = request.body
    const { userId } = request.user

    // Find all records in zone with unpaid fees, no existing notice
    const records = await sql`
      SELECT
        tr.record_id,
        tr.taxpayer_name,
        tr.taxpayer_phone,
        z.zone_name,
        rt.type_name AS record_type,
        SUM(fa.amount_due) AS amount_due
      FROM taxpayer_record tr
      JOIN zone z USING (zone_id)
      JOIN record_type rt USING (record_type_id)
      JOIN fee_assignment fa USING (record_id)
      WHERE tr.zone_id = ${zoneId}
        AND tr.status_id = 2
        AND fa.billing_year = ${billingYear}
        AND fa.is_waived = FALSE
        AND (${recordTypeId ?? null}::int IS NULL OR tr.record_type_id = ${recordTypeId ?? null})
        AND NOT EXISTS (
          SELECT 1 FROM demand_notice dn
          WHERE dn.record_id = tr.record_id
            AND dn.notice_status != 'cancelled'
            AND EXTRACT(YEAR FROM dn.issued_date) = ${billingYear}
        )
      GROUP BY tr.record_id, tr.taxpayer_name, tr.taxpayer_phone, z.zone_name, rt.type_name
      HAVING SUM(fa.amount_due) > 0
    `

    if (records.length === 0) {
      return { generated: 0, message: 'No eligible records for bulk notice generation' }
    }

    // Pull county code once; sequence is allocated per row via next_notice_seq()
    const [{ countyCode }] = await sql`
      SELECT COALESCE(county_code, 'NCC') AS county_code FROM arcgis_config LIMIT 1
    `.then((r) => r.length ? r : [{ countyCode: 'NCC' }])

    // Insert notices for all — each gets its own [COUNTY]-[YEAR]-[SEQUENCE] number.
    const noticesData = []
    for (const r of records) {
      const [{ nextNoticeSeq: seq }] = await sql`
        SELECT next_notice_seq(${countyCode}, ${billingYear}) AS next_notice_seq
      `
      noticesData.push([
        r.recordId,
        null,
        `${countyCode}-${billingYear}-${String(seq).padStart(6, '0')}`,
        r.amountDue,
        new Date().toISOString().split('T')[0],
        dueDate,
        userId,
      ])
    }

    const inserted = await sql`
      INSERT INTO demand_notice (record_id, assignment_id, notice_number, amount_due, issued_date, due_date, generated_by)
      VALUES ${sql(noticesData)}
      RETURNING notice_id
    `

    // Queue PDF generation in background
    try {
      await queuePDFGeneration(inserted.map(n => n.noticeId))
    } catch (err) {
      fastify.log.error({ err }, 'Failed to queue bulk PDF generation')
    }

    await sql`
      INSERT INTO audit_log (user_id, action, new_values, ip_address)
      VALUES (${userId}, 'BULK_GENERATE_NOTICES', ${JSON.stringify({ zoneId, billingYear, count: records.length })}, ${request.ip}::inet)
    `

    return {
      generated: records.length,
      totalAmount: records.reduce((sum, r) => sum + Number(r.amountDue), 0),
      message: `${records.length} notices generated`,
    }
  })

  // GET /api/notices/:id/pdf — download notice PDF
  fastify.get('/:id/pdf', {
    preHandler: fastify.authenticate,
  }, async (request, reply) => {
    const { id } = request.params

    const [notice] = await sql`
      SELECT notice_id, notice_number, pdf_path FROM demand_notice WHERE notice_id = ${id}
    `

    if (!notice) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Notice not found' })
    if (!notice.pdfPath) return reply.status(202).send({ message: 'PDF is still being generated. Try again in a moment.' })

    const { createReadStream, existsSync } = await import('fs')
    if (!existsSync(notice.pdfPath)) {
      return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'PDF not found on server' })
    }
    reply.header('Content-Type', 'application/pdf')
    reply.header('Content-Disposition', `attachment; filename="${notice.noticeNumber}.pdf"`)
    return reply.send(createReadStream(notice.pdfPath))
  })

  // PATCH /api/notices/:id/status — update notice status. Cancelling is the
  // sanctioned correction path for a wrongly issued notice and REQUIRES a
  // written reason, which is stored on the row and in the audit log.
  fastify.patch('/:id/status', {
    preHandler: fastify.requireRole('admin', 'finance_manager'),
    schema: {
      body: {
        type: 'object',
        required: ['status'],
        properties: {
          status: { type: 'string', enum: ['issued', 'paid', 'overdue', 'cancelled'] },
          reason: { type: 'string', minLength: 10, maxLength: 1000 },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params
    const { status, reason } = request.body
    const { userId } = request.user

    if (status === 'cancelled' && !reason) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Cancelling a notice requires a reason (min 10 characters).',
      })
    }

    const [before] = await sql`
      SELECT notice_id, notice_status, cancelled_reason FROM demand_notice WHERE notice_id = ${id}
    `
    if (!before) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Notice not found' })

    const [result] = await sql`
      UPDATE demand_notice
      SET notice_status = ${status},
          cancelled_reason = ${status === 'cancelled' ? reason : null}
      WHERE notice_id = ${id}
      RETURNING notice_id
    `

    await sql`
      INSERT INTO audit_log (user_id, action, table_name, record_id, old_values, new_values, ip_address)
      VALUES (
        ${userId}, 'UPDATE_NOTICE_STATUS', 'demand_notice', ${id},
        ${JSON.stringify({ status: before.noticeStatus })},
        ${JSON.stringify({ status, reason: reason ?? null })},
        ${request.ip}::inet
      )
    `

    return { message: `Notice status updated to ${status}` }
  })
}
