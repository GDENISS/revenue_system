// src/routes/fees.js
import { getDb } from '../db.js'

export default async function feeRoutes(fastify) {
  const sql = getDb()

  // GET /api/fees/schedules — list fee schedules
  fastify.get('/schedules', {
    preHandler: fastify.authenticate,
  }, async (request) => {
    const { recordTypeId, zoneId, activeOnly = true } = request.query

    return sql`
      SELECT
        fs.*,
        rt.type_name AS record_type_name,
        z.zone_name,
        u.name AS created_by_name
      FROM fee_schedule fs
      JOIN record_type rt USING (record_type_id)
      LEFT JOIN zone z USING (zone_id)
      LEFT JOIN users u ON u.user_id = fs.created_by
      WHERE
        (${recordTypeId ?? null}::int IS NULL OR fs.record_type_id = ${recordTypeId ?? null})
        AND (${zoneId ?? null}::int IS NULL OR fs.zone_id = ${zoneId ?? null} OR fs.zone_id IS NULL)
        AND (${activeOnly}::boolean = FALSE OR fs.is_active = TRUE)
      ORDER BY fs.record_type_id, fs.effective_from DESC
    `
  })

  // POST /api/fees/schedules — create fee schedule (admin/finance_manager only)
  fastify.post('/schedules', {
    preHandler: fastify.requireRole('admin', 'finance_manager'),
    schema: {
      body: {
        type: 'object',
        required: ['scheduleName', 'recordTypeId', 'amount', 'effectiveFrom'],
        properties: {
          scheduleName:  { type: 'string' },
          recordTypeId:  { type: 'integer' },
          zoneId:        { type: 'integer' },
          amount:        { type: 'number', minimum: 0 },
          billingPeriod: { type: 'string', enum: ['annual', 'monthly', 'once'], default: 'annual' },
          effectiveFrom: { type: 'string', format: 'date' },
          effectiveTo:   { type: 'string', format: 'date' },
        },
      },
    },
  }, async (request, reply) => {
    const { scheduleName, recordTypeId, zoneId, amount, billingPeriod, effectiveFrom, effectiveTo } = request.body
    const { userId } = request.user

    // Guard against broken validity windows — three of the first five
    // schedules created through this form had inverted or one-day ranges,
    // which silently break fee auto-assignment for their record type.
    if (effectiveTo && effectiveTo < effectiveFrom) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: `End date (${effectiveTo}) is before the start date (${effectiveFrom}). Leave "effective to" empty for an open-ended schedule.`,
      })
    }

    const [schedule] = await sql`
      INSERT INTO fee_schedule
        (schedule_name, record_type_id, zone_id, amount, billing_period, effective_from, effective_to, created_by)
      VALUES
        (${scheduleName}, ${recordTypeId}, ${zoneId || null}, ${amount}, ${billingPeriod ?? 'annual'},
         ${effectiveFrom}, ${effectiveTo ?? null}, ${userId})
      RETURNING schedule_id
    `

    await sql`
      INSERT INTO audit_log (user_id, action, table_name, record_id, new_values, ip_address)
      VALUES (${userId}, 'CREATE_FEE_SCHEDULE', 'fee_schedule', ${schedule.scheduleId}, ${JSON.stringify(request.body)}, ${request.ip}::inet)
    `

    return reply.status(201).send({ scheduleId: schedule.scheduleId, message: 'Fee schedule created' })
  })

  // POST /api/fees/assign — assign fee to a record
  fastify.post('/assign', {
    preHandler: fastify.requireRole('admin', 'finance_manager'),
    schema: {
      body: {
        type: 'object',
        required: ['recordId', 'scheduleId', 'billingYear', 'dueDate'],
        properties: {
          recordId:    { type: 'integer' },
          scheduleId:  { type: 'integer' },
          billingYear: { type: 'integer' },
          dueDate:     { type: 'string', format: 'date' },
        },
      },
    },
  }, async (request, reply) => {
    const { recordId, scheduleId, billingYear, dueDate } = request.body
    const { userId } = request.user

    // Validate record exists
    const [record] = await sql`SELECT record_id FROM taxpayer_record WHERE record_id = ${recordId}`
    if (!record) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Record not found' })

    // Get schedule amount
    const [schedule] = await sql`SELECT amount FROM fee_schedule WHERE schedule_id = ${scheduleId} AND is_active = TRUE`
    if (!schedule) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Fee schedule not found or inactive' })

    // Check for duplicate assignment
    const [existing] = await sql`
      SELECT assignment_id FROM fee_assignment
      WHERE record_id = ${recordId} AND schedule_id = ${scheduleId} AND billing_year = ${billingYear}
    `
    if (existing) return reply.status(409).send({ statusCode: 409, error: 'Conflict', message: 'Fee already assigned for this year' })

    const [assignment] = await sql`
      INSERT INTO fee_assignment (record_id, schedule_id, assigned_by, billing_year, amount_due, due_date)
      VALUES (${recordId}, ${scheduleId}, ${userId}, ${billingYear}, ${schedule.amount}, ${dueDate})
      RETURNING assignment_id
    `

    await sql`
      INSERT INTO audit_log (user_id, action, table_name, record_id, new_values, ip_address)
      VALUES (${userId}, 'ASSIGN_FEE', 'fee_assignment', ${assignment.assignmentId}, ${JSON.stringify(request.body)}, ${request.ip}::inet)
    `

    return reply.status(201).send({ assignmentId: assignment.assignmentId, amountDue: schedule.amount, message: 'Fee assigned successfully' })
  })

  // POST /api/fees/assign/bulk — bulk assign fees by zone
  fastify.post('/assign/bulk', {
    preHandler: fastify.requireRole('admin', 'finance_manager'),
    schema: {
      body: {
        type: 'object',
        required: ['scheduleId', 'zoneId', 'billingYear', 'dueDate'],
        properties: {
          scheduleId:    { type: 'integer' },
          zoneId:        { type: 'integer' },
          billingYear:   { type: 'integer' },
          dueDate:       { type: 'string', format: 'date' },
          recordTypeId:  { type: 'integer' },
        },
      },
    },
  }, async (request, reply) => {
    const { scheduleId, zoneId, billingYear, dueDate, recordTypeId } = request.body
    const { userId } = request.user

    const [schedule] = await sql`SELECT amount FROM fee_schedule WHERE schedule_id = ${scheduleId} AND is_active = TRUE`
    if (!schedule) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Fee schedule not found' })

    // Get all eligible records not already assigned
    const records = await sql`
      SELECT tr.record_id
      FROM taxpayer_record tr
      WHERE tr.zone_id = ${zoneId}
        AND tr.status_id = 2  -- active only
        AND (${recordTypeId ?? null}::int IS NULL OR tr.record_type_id = ${recordTypeId ?? null})
        AND NOT EXISTS (
          SELECT 1 FROM fee_assignment fa
          WHERE fa.record_id = tr.record_id
            AND fa.schedule_id = ${scheduleId}
            AND fa.billing_year = ${billingYear}
        )
    `

    if (records.length === 0) {
      return { assigned: 0, message: 'No eligible records found (already assigned or none match criteria)' }
    }

    // Bulk insert
    await sql`
      INSERT INTO fee_assignment (record_id, schedule_id, assigned_by, billing_year, amount_due, due_date)
      VALUES ${sql(records.map(r => [r.recordId, scheduleId, userId, billingYear, schedule.amount, dueDate]))}
    `

    await sql`
      INSERT INTO audit_log (user_id, action, new_values, ip_address)
      VALUES (${userId}, 'BULK_ASSIGN_FEE', ${JSON.stringify({ ...request.body, recordCount: records.length })}, ${request.ip}::inet)
    `

    return { assigned: records.length, amountPerRecord: schedule.amount, totalAmount: records.length * schedule.amount, message: `Fee assigned to ${records.length} records` }
  })

  // PATCH /api/fees/assign/:id/waive — waive a fee
  fastify.patch('/assign/:id/waive', {
    preHandler: fastify.requireRole('admin', 'finance_manager'),
    schema: {
      body: {
        type: 'object',
        required: ['reason'],
        properties: { reason: { type: 'string', minLength: 5 } },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params
    const { reason } = request.body
    const { userId } = request.user

    const [result] = await sql`
      UPDATE fee_assignment
      SET is_waived = TRUE, waived_by = ${userId}, waived_reason = ${reason}
      WHERE assignment_id = ${id}
      RETURNING assignment_id
    `

    if (!result) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Fee assignment not found' })

    await sql`
      INSERT INTO audit_log (user_id, action, table_name, record_id, new_values, ip_address)
      VALUES (${userId}, 'WAIVE_FEE', 'fee_assignment', ${id}, ${JSON.stringify({ reason })}, ${request.ip}::inet)
    `

    return { message: 'Fee waived successfully' }
  })
}
