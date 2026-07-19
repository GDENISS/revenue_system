// src/routes/records.js
import { getDb } from '../db.js'
import { closeTasksForRecord } from './tasks.js'

/**
 * Normalize + validate a Kenyan phone number. Accepts 07XX/01XX local form,
 * 2547.../2541..., or +254 with 9 further digits; returns canonical +254...
 * Returns { ok, value } — callers surface the error on failure.
 */
export function normalizeKenyanPhone(raw) {
  if (raw == null || String(raw).trim() === '') return { ok: true, value: null }
  const digits = String(raw).replace(/[\s\-().]/g, '')
  let m
  if ((m = /^\+?254(7\d{8}|1\d{8})$/.exec(digits))) return { ok: true, value: `+254${m[1]}` }
  if ((m = /^0(7\d{8}|1\d{8})$/.exec(digits))) return { ok: true, value: `+254${m[1]}` }
  return { ok: false, value: null }
}

/** National ID / passport shape: 6-10 alphanumeric characters. */
export function isValidIdNo(raw) {
  if (raw == null || String(raw).trim() === '') return true
  return /^[A-Za-z0-9]{6,10}$/.test(String(raw).trim())
}

export default async function recordRoutes(fastify) {
  const sql = getDb()

  // GET /api/records — list with filtering + pagination
  fastify.get('/', {
    preHandler: fastify.authenticate,
    schema: {
      querystring: {
        type: 'object',
        properties: {
          page:          { type: 'integer', minimum: 1, default: 1 },
          limit:         { type: 'integer', minimum: 1, maximum: 200, default: 50 },
          zoneId:        { type: 'integer' },
          recordTypeId:  { type: 'integer' },
          statusId:      { type: 'integer' },
          search:        { type: 'string' },
          // true → records without an ArcGIS link (awaiting GIS capture)
          // false → records that ARE linked to a feature
          unmapped:      { type: 'boolean' },
          // Exact lookup by the linked ArcGIS feature OBJECTID
          arcgisObjectId:{ type: 'integer' },
        },
      },
    },
  }, async (request) => {
    const { page = 1, limit = 50, zoneId, recordTypeId, statusId, search, unmapped, arcgisObjectId } = request.query
    const offset = (page - 1) * limit
    const { role, zoneId: userZoneId } = request.user

    // Officers can only see records in their zone. Coalesce undefineds to null
    // — postgres.js refuses to bind `undefined`.
    const effectiveZoneId    = (role === 'officer' ? userZoneId : zoneId) ?? null
    const effectiveTypeId    = recordTypeId ?? null
    const effectiveStatusId  = statusId ?? null
    const effectiveSearch    = search ?? null
    const effectiveUnmapped  = unmapped ?? null
    const effectiveArcgisOid = arcgisObjectId ?? null

    const records = await sql`
      SELECT
        tr.record_id,
        tr.taxpayer_name,
        tr.taxpayer_phone,
        tr.taxpayer_email,
        tr.taxpayer_id_no,
        tr.arcgis_object_id,
        tr.submission_date,
        tr.updated_at,
        rt.type_name AS record_type,
        z.zone_name,
        z.zone_id,
        s.status_name AS status,
        u.name AS submitted_by_name,
        -- Outstanding balance
        COALESCE(
          (SELECT SUM(fa.amount_due)
           FROM fee_assignment fa
           WHERE fa.record_id = tr.record_id
             AND fa.is_waived = FALSE
          ) -
          (SELECT COALESCE(SUM(p.amount_paid), 0)
           FROM payment p
           WHERE p.record_id = tr.record_id
          ), 0
        ) AS outstanding_balance
      FROM taxpayer_record tr
      JOIN record_type rt USING (record_type_id)
      JOIN zone z USING (zone_id)
      JOIN status s USING (status_id)
      LEFT JOIN users u ON u.user_id = tr.submitted_by
      WHERE
        (${effectiveZoneId}::int IS NULL OR tr.zone_id = ${effectiveZoneId})
        AND (${effectiveTypeId}::int IS NULL OR tr.record_type_id = ${effectiveTypeId})
        AND (${effectiveStatusId}::int IS NULL OR tr.status_id = ${effectiveStatusId})
        AND (${effectiveSearch}::text IS NULL OR tr.taxpayer_name ILIKE ${'%' + (effectiveSearch ?? '') + '%'})
        AND (
          ${effectiveUnmapped}::boolean IS NULL
          OR (${effectiveUnmapped}::boolean = TRUE  AND tr.arcgis_object_id IS NULL)
          OR (${effectiveUnmapped}::boolean = FALSE AND tr.arcgis_object_id IS NOT NULL)
        )
        AND (${effectiveArcgisOid}::bigint IS NULL OR tr.arcgis_object_id = ${effectiveArcgisOid})
      ORDER BY tr.updated_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `

    const [{ total }] = await sql`
      SELECT COUNT(*)::int AS total
      FROM taxpayer_record tr
      WHERE
        (${effectiveZoneId}::int IS NULL OR tr.zone_id = ${effectiveZoneId})
        AND (${effectiveTypeId}::int IS NULL OR tr.record_type_id = ${effectiveTypeId})
        AND (${effectiveStatusId}::int IS NULL OR tr.status_id = ${effectiveStatusId})
        AND (${effectiveSearch}::text IS NULL OR tr.taxpayer_name ILIKE ${'%' + (effectiveSearch ?? '') + '%'})
        AND (
          ${effectiveUnmapped}::boolean IS NULL
          OR (${effectiveUnmapped}::boolean = TRUE  AND tr.arcgis_object_id IS NULL)
          OR (${effectiveUnmapped}::boolean = FALSE AND tr.arcgis_object_id IS NOT NULL)
        )
        AND (${effectiveArcgisOid}::bigint IS NULL OR tr.arcgis_object_id = ${effectiveArcgisOid})
    `

    return {
      data: records,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    }
  })

  // GET /api/records/:id — single record with full detail
  fastify.get('/:id', {
    preHandler: fastify.authenticate,
  }, async (request, reply) => {
    const { id } = request.params

    const [record] = await sql`
      SELECT
        tr.*,
        rt.type_name AS record_type,
        rt.geometry_type,
        z.zone_name,
        s.status_name AS status,
        u.name AS submitted_by_name,
        -- Outstanding balance — same formula as the list endpoint so the
        -- detail view matches the row.
        COALESCE(
          (SELECT SUM(fa.amount_due)
           FROM fee_assignment fa
           WHERE fa.record_id = tr.record_id
             AND fa.is_waived = FALSE
          ) -
          (SELECT COALESCE(SUM(p.amount_paid), 0)
           FROM payment p
           WHERE p.record_id = tr.record_id
          ), 0
        ) AS outstanding_balance
      FROM taxpayer_record tr
      JOIN record_type rt USING (record_type_id)
      JOIN zone z USING (zone_id)
      JOIN status s USING (status_id)
      LEFT JOIN users u ON u.user_id = tr.submitted_by
      WHERE tr.record_id = ${id}
    `

    if (!record) {
      return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Record not found' })
    }

    // Attributes
    const attributes = await sql`
      SELECT attribute_key, attribute_val
      FROM record_attributes
      WHERE record_id = ${id}
    `

    // Fee assignments
    const fees = await sql`
      SELECT
        fa.*,
        fs.schedule_name,
        fs.billing_period
      FROM fee_assignment fa
      JOIN fee_schedule fs USING (schedule_id)
      WHERE fa.record_id = ${id}
      ORDER BY fa.billing_year DESC
    `

    // Notices
    const notices = await sql`
      SELECT notice_id, notice_number, amount_due, issued_date, due_date, notice_status
      FROM demand_notice
      WHERE record_id = ${id}
      ORDER BY issued_date DESC
    `

    // Payment history (include Paystack fields so the record-ledger row can
    // also show the "via Paystack" annotation).
    const payments = await sql`
      SELECT payment_id, amount_paid, payment_method, mpesa_ref, bank_ref,
             payment_date, receipt_number, paystack_reference, gateway_response
      FROM payment
      WHERE record_id = ${id}
      ORDER BY payment_date DESC
    `

    return { ...record, attributes, fees, notices, payments }
  })

  // POST /api/records — create new record (officer+)
  fastify.post('/', {
    preHandler: fastify.authenticate,
    schema: {
      body: {
        type: 'object',
        required: ['recordTypeId', 'taxpayerName', 'zoneId'],
        properties: {
          recordTypeId:    { type: 'integer' },
          taxpayerName:    { type: 'string', minLength: 2, maxLength: 200 },
          taxpayerPhone:   { type: 'string' },
          taxpayerEmail:   { type: 'string', format: 'email' },
          taxpayerIdNo:    { type: 'string' },
          zoneId:          { type: 'integer' },
          arcgisObjectId:  { type: 'integer' },
          attributes:      { type: 'array', items: {
            type: 'object',
            properties: { key: { type: 'string' }, value: { type: 'string' } },
          }},
        },
      },
    },
  }, async (request, reply) => {
    const {
      recordTypeId, taxpayerName, taxpayerEmail,
      taxpayerIdNo, zoneId, arcgisObjectId,
      attributes = [],
    } = request.body
    const { userId } = request.user

    // Normalize + validate contact details before anything touches the DB.
    const phone = normalizeKenyanPhone(request.body.taxpayerPhone)
    if (!phone.ok) {
      return reply.status(400).send({
        statusCode: 400, error: 'Bad Request',
        message: 'Invalid Kenyan phone number. Use 07XX XXX XXX, 01XX XXX XXX, or +254 format.',
      })
    }
    const taxpayerPhone = phone.value
    if (!isValidIdNo(taxpayerIdNo)) {
      return reply.status(400).send({
        statusCode: 400, error: 'Bad Request',
        message: 'ID number must be 6–10 letters/digits.',
      })
    }

    // If a feature was provided, refuse if it's already bound to a record
    if (arcgisObjectId != null) {
      const [dup] = await sql`
        SELECT record_id FROM taxpayer_record
        WHERE arcgis_object_id = ${arcgisObjectId}
          AND record_type_id = ${recordTypeId}
      `
      if (dup) {
        return reply.status(409).send({
          statusCode: 409,
          error: 'Conflict',
          message: `Feature ${arcgisObjectId} is already linked to record ${dup.recordId}`,
        })
      }
    }

    // Spatial data lives in ArcGIS — Postgres just stores attributes + the
    // arcgis_object_id pointer.
    const [record] = await sql`
      INSERT INTO taxpayer_record (
        record_type_id, taxpayer_name, taxpayer_phone, taxpayer_email,
        taxpayer_id_no, zone_id, status_id, submitted_by,
        arcgis_object_id
      ) VALUES (
        ${recordTypeId}, ${taxpayerName}, ${taxpayerPhone ?? null}, ${taxpayerEmail ?? null},
        ${taxpayerIdNo ?? null}, ${zoneId}, 1, ${userId},
        ${arcgisObjectId ?? null}
      )
      RETURNING record_id
    `

    // Insert attributes
    if (attributes.length > 0) {
      await sql`
        INSERT INTO record_attributes (record_id, attribute_key, attribute_val)
        VALUES ${sql(attributes.map(a => [record.recordId, a.key, a.value]))}
      `
    }

    // ── Auto fee assignment ──────────────────────────────────────────
    // Pick the best matching active fee schedule (zone-specific first,
    // then default; most recent effective_from wins). When found, write
    // a fee_assignment row for the current billing year so the dashboard
    // and notice flows pick the record up immediately.
    const billingYear = new Date().getFullYear()
    const [schedule] = await sql`
      SELECT schedule_id, amount
      FROM fee_schedule
      WHERE record_type_id = ${recordTypeId}
        AND is_active = TRUE
        AND (zone_id IS NULL OR zone_id = ${zoneId})
        AND effective_from <= CURRENT_DATE
        AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
      ORDER BY (zone_id IS NOT NULL) DESC, effective_from DESC
      LIMIT 1
    `
    let assignmentId = null
    if (schedule) {
      const dueDate = new Date(billingYear, 5, 30).toISOString().split('T')[0] // 30 June
      const [assignment] = await sql`
        INSERT INTO fee_assignment
          (record_id, schedule_id, assigned_by, billing_year, amount_due, due_date)
        VALUES
          (${record.recordId}, ${schedule.scheduleId}, ${userId},
           ${billingYear}, ${schedule.amount}, ${dueDate})
        ON CONFLICT DO NOTHING
        RETURNING assignment_id
      `
      assignmentId = assignment?.assignmentId ?? null
    }

    // Audit
    await sql`
      INSERT INTO audit_log (user_id, action, table_name, record_id, new_values, ip_address)
      VALUES (
        ${userId}, 'CREATE_RECORD', 'taxpayer_record', ${record.recordId},
        ${JSON.stringify({ ...request.body, autoAssignmentId: assignmentId })},
        ${request.ip}::inet
      )
    `
    if (assignmentId) {
      await sql`
        INSERT INTO audit_log (user_id, action, table_name, record_id, new_values, ip_address)
        VALUES (
          ${userId}, 'AUTO_ASSIGN_FEE', 'fee_assignment', ${assignmentId},
          ${JSON.stringify({ recordId: record.recordId, scheduleId: schedule.scheduleId, amount: schedule.amount })},
          ${request.ip}::inet
        )
      `
    }

    return reply.status(201).send({
      recordId: record.recordId,
      autoAssignmentId: assignmentId,
      message: assignmentId
        ? 'Record created and fee auto-assigned'
        : 'Record created (no matching fee schedule — assign manually)',
    })
  })

  // PATCH /api/records/:id — update record
  fastify.patch('/:id', {
    preHandler: fastify.authenticate,
    schema: {
      body: {
        type: 'object',
        properties: {
          taxpayerName:    { type: 'string' },
          taxpayerPhone:   { type: 'string' },
          taxpayerEmail:   { type: 'string' },
          taxpayerIdNo:    { type: 'string' },
          zoneId:          { type: 'integer' },
          statusId:        { type: 'integer' },
          arcgisObjectId:  { type: ['integer', 'null'] },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params
    const { userId, role } = request.user

    // Full row fetch so the audit entry can capture what the data looked
    // like BEFORE the change — required for tamper investigation.
    const [existing] = await sql`
      SELECT record_id, record_type_id, taxpayer_name, taxpayer_phone,
             taxpayer_email, taxpayer_id_no, zone_id, status_id, arcgis_object_id
      FROM taxpayer_record WHERE record_id = ${id}
    `
    if (!existing) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Record not found' })

    const {
      taxpayerName, taxpayerEmail, taxpayerIdNo,
      zoneId, statusId, arcgisObjectId,
    } = request.body

    // Same contact validation as create.
    let taxpayerPhone = request.body.taxpayerPhone
    if (taxpayerPhone !== undefined) {
      const phone = normalizeKenyanPhone(taxpayerPhone)
      if (!phone.ok) {
        return reply.status(400).send({
          statusCode: 400, error: 'Bad Request',
          message: 'Invalid Kenyan phone number. Use 07XX XXX XXX, 01XX XXX XXX, or +254 format.',
        })
      }
      taxpayerPhone = phone.value
    }
    if (taxpayerIdNo !== undefined && !isValidIdNo(taxpayerIdNo)) {
      return reply.status(400).send({
        statusCode: 400, error: 'Bad Request',
        message: 'ID number must be 6–10 letters/digits.',
      })
    }

    // Only admin/finance_manager can change status or zone
    if ((statusId || zoneId) && role === 'officer') {
      return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Officers cannot change status or zone' })
    }

    // Linking: refuse if some OTHER record of the same type already owns this OBJECTID
    if (arcgisObjectId != null) {
      const [dup] = await sql`
        SELECT record_id FROM taxpayer_record
        WHERE arcgis_object_id = ${arcgisObjectId}
          AND record_type_id = ${existing.recordTypeId}
          AND record_id <> ${id}
      `
      if (dup) {
        return reply.status(409).send({
          statusCode: 409,
          error: 'Conflict',
          message: `Feature ${arcgisObjectId} is already linked to record ${dup.recordId}`,
        })
      }
    }

    // We treat the property's presence (not value) as intent to set.
    // `null` clears the link, `undefined`/absent leaves it unchanged.
    const arcgisExplicit = Object.prototype.hasOwnProperty.call(request.body, 'arcgisObjectId')

    await sql`
      UPDATE taxpayer_record SET
        taxpayer_name     = COALESCE(${taxpayerName ?? null}, taxpayer_name),
        taxpayer_phone    = COALESCE(${taxpayerPhone ?? null}, taxpayer_phone),
        taxpayer_email    = COALESCE(${taxpayerEmail ?? null}, taxpayer_email),
        taxpayer_id_no    = COALESCE(${taxpayerIdNo ?? null}, taxpayer_id_no),
        zone_id           = COALESCE(${zoneId ?? null}, zone_id),
        status_id         = COALESCE(${statusId ?? null}, status_id),
        arcgis_object_id  = CASE WHEN ${arcgisExplicit}::boolean THEN ${arcgisObjectId ?? null}::int ELSE arcgis_object_id END,
        updated_at = NOW()
      WHERE record_id = ${id}
    `

    // Spatial data just landed → auto-complete any open field-capture task.
    if (arcgisExplicit && arcgisObjectId != null) {
      try {
        const closed = await closeTasksForRecord(sql, id)
        if (closed.length) {
          fastify.log.info(`Auto-completed ${closed.length} field task(s) for record ${id}`)
        }
      } catch (err) {
        fastify.log.warn({ err }, 'Failed to auto-close field tasks')
      }
    }

    await sql`
      INSERT INTO audit_log (user_id, action, table_name, record_id, old_values, new_values, ip_address)
      VALUES (
        ${userId}, 'UPDATE_RECORD', 'taxpayer_record', ${id},
        ${JSON.stringify({
          taxpayerName: existing.taxpayerName,
          taxpayerPhone: existing.taxpayerPhone,
          taxpayerEmail: existing.taxpayerEmail,
          taxpayerIdNo: existing.taxpayerIdNo,
          zoneId: existing.zoneId,
          statusId: existing.statusId,
          arcgisObjectId: existing.arcgisObjectId,
        })},
        ${JSON.stringify(request.body)},
        ${request.ip}::inet
      )
    `

    return { message: 'Record updated successfully' }
  })

  // GET /api/records/types — list record types
  fastify.get('/types/list', {
    preHandler: fastify.authenticate,
    config: { public: false },
  }, async () => {
    return sql`SELECT record_type_id, type_name, geometry_type, description FROM record_type WHERE is_active = TRUE ORDER BY type_name`
  })
}
