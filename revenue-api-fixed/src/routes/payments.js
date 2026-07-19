// src/routes/payments.js
import { getDb } from '../db.js'
import {
  initializeTransaction as paystackInit,
  verifyTransaction as paystackVerify,
  verifyWebhookSignature,
  mapChannelToMethod,
} from '../services/paystack.js'

export default async function paymentRoutes(fastify) {
  const sql = getDb()

  // POST /api/payments — record a payment
  fastify.post('/', {
    preHandler: fastify.authenticate,
    schema: {
      body: {
        type: 'object',
        required: ['recordId', 'amountPaid', 'paymentMethod', 'paymentDate'],
        properties: {
          recordId:       { type: 'integer' },
          noticeId:       { type: 'integer' },
          amountPaid:     { type: 'number', minimum: 0.01 },
          paymentMethod:  { type: 'string', enum: ['mpesa', 'bank', 'cash', 'cheque'] },
          mpesaRef:       { type: 'string' },
          bankRef:        { type: 'string' },
          paymentDate:    { type: 'string', format: 'date-time' },
          notes:          { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const {
      recordId, noticeId, amountPaid, paymentMethod,
      mpesaRef, bankRef, paymentDate, notes,
    } = request.body
    const { userId } = request.user

    // Validate record exists
    const [record] = await sql`SELECT record_id FROM taxpayer_record WHERE record_id = ${recordId}`
    if (!record) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Record not found' })

    // Check for M-Pesa duplicate
    if (paymentMethod === 'mpesa' && mpesaRef) {
      const [dup] = await sql`SELECT payment_id FROM payment WHERE mpesa_ref = ${mpesaRef}`
      if (dup) return reply.status(409).send({ statusCode: 409, error: 'Conflict', message: `M-Pesa reference ${mpesaRef} already recorded` })
    }

    // Generate receipt number
    const receiptNumber = `RCP-${new Date().getFullYear()}-${Date.now().toString().slice(-8)}`

    const [payment] = await sql`
      INSERT INTO payment (record_id, notice_id, amount_paid, payment_method, mpesa_ref, bank_ref, payment_date, receipt_number, recorded_by, notes)
      VALUES (
        ${recordId}, ${noticeId ?? null}, ${amountPaid}, ${paymentMethod},
        ${mpesaRef ?? null}, ${bankRef ?? null}, ${paymentDate}, ${receiptNumber}, ${userId}, ${notes ?? null}
      )
      RETURNING payment_id, receipt_number
    `

    // ── Auto-mark notices as paid ────────────────────────────────────
    // Two passes:
    //  (a) If this payment was tagged to a specific notice and that notice's
    //      own balance is settled, mark it.
    //  (b) RECORD-LEVEL settle: if the record's total obligations are now
    //      covered by total payments, mark every still-open notice on that
    //      record as paid. This handles payments recorded against the
    //      record without picking a notice.
    if (noticeId) {
      const [notice] = await sql`SELECT amount_due FROM demand_notice WHERE notice_id = ${noticeId}`
      const [{ totalPaid }] = await sql`
        SELECT COALESCE(SUM(amount_paid), 0)::numeric AS total_paid
        FROM payment WHERE notice_id = ${noticeId}
      `
      if (notice && Number(totalPaid) >= Number(notice.amountDue)) {
        await sql`UPDATE demand_notice SET notice_status = 'paid' WHERE notice_id = ${noticeId}`
      }
    }

    const [balRow] = await sql`
      SELECT
        COALESCE((
          SELECT SUM(fa.amount_due) FROM fee_assignment fa
          WHERE fa.record_id = ${recordId} AND fa.is_waived = FALSE
        ), 0)
        - COALESCE((
          SELECT SUM(p.amount_paid) FROM payment p
          WHERE p.record_id = ${recordId}
        ), 0) AS remaining
    `
    if (Number(balRow.remaining) <= 0) {
      await sql`
        UPDATE demand_notice
           SET notice_status = 'paid'
         WHERE record_id = ${recordId}
           AND notice_status IN ('issued', 'overdue')
      `
    }

    await sql`
      INSERT INTO audit_log (user_id, action, table_name, record_id, new_values, ip_address)
      VALUES (${userId}, 'RECORD_PAYMENT', 'payment', ${payment.paymentId}, ${JSON.stringify(request.body)}, ${request.ip}::inet)
    `

    return reply.status(201).send({
      paymentId: payment.paymentId,
      receiptNumber: payment.receiptNumber,
      message: 'Payment recorded successfully',
    })
  })

  // GET /api/payments — list payments with filters
  fastify.get('/', {
    preHandler: fastify.authenticate,
    schema: {
      querystring: {
        type: 'object',
        properties: {
          page:          { type: 'integer', default: 1 },
          limit:         { type: 'integer', default: 50, maximum: 200 },
          recordId:      { type: 'integer' },
          paymentMethod: { type: 'string' },
          dateFrom:      { type: 'string', format: 'date' },
          dateTo:        { type: 'string', format: 'date' },
          mpesaRef:      { type: 'string' },
        },
      },
    },
  }, async (request) => {
    const { page = 1, limit = 50, recordId, paymentMethod, dateFrom, dateTo, mpesaRef } = request.query
    const offset = (page - 1) * limit

    const payments = await sql`
      SELECT
        p.*,
        tr.taxpayer_name,
        u.name AS recorded_by_name,
        dn.notice_number
      FROM payment p
      JOIN taxpayer_record tr USING (record_id)
      LEFT JOIN users u ON u.user_id = p.recorded_by
      LEFT JOIN demand_notice dn USING (notice_id)
      WHERE
        (${recordId ?? null}::int IS NULL OR p.record_id = ${recordId ?? null})
        AND (${paymentMethod ?? null}::text IS NULL OR p.payment_method = ${paymentMethod ?? null})
        AND (${mpesaRef ?? null}::text IS NULL OR p.mpesa_ref = ${mpesaRef ?? null})
        AND (${dateFrom ?? null}::date IS NULL OR p.payment_date::date >= ${dateFrom ?? null}::date)
        AND (${dateTo ?? null}::date IS NULL OR p.payment_date::date <= ${dateTo ?? null}::date)
      ORDER BY p.payment_date DESC
      LIMIT ${limit} OFFSET ${offset}
    `

    const [{ total }] = await sql`
      SELECT COUNT(*)::int AS total
      FROM payment p
      WHERE
        (${recordId ?? null}::int IS NULL OR p.record_id = ${recordId ?? null})
        AND (${paymentMethod ?? null}::text IS NULL OR p.payment_method = ${paymentMethod ?? null})
        AND (${mpesaRef ?? null}::text IS NULL OR p.mpesa_ref = ${mpesaRef ?? null})
        AND (${dateFrom ?? null}::date IS NULL OR p.payment_date::date >= ${dateFrom ?? null}::date)
        AND (${dateTo ?? null}::date IS NULL OR p.payment_date::date <= ${dateTo ?? null}::date)
    `

    return { data: payments, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } }
  })

  // GET /api/payments/summary — aggregates by method, totals, daily series
  fastify.get('/summary', {
    preHandler: fastify.authenticate,
    schema: {
      querystring: {
        type: 'object',
        properties: {
          dateFrom: { type: 'string', format: 'date' },
          dateTo:   { type: 'string', format: 'date' },
          zoneId:   { type: 'integer' },
        },
      },
    },
  }, async (request) => {
    const { dateFrom, dateTo, zoneId } = request.query

    const [totals] = await sql`
      SELECT
        COALESCE(SUM(p.amount_paid), 0)::numeric AS total_collected,
        COUNT(*)::int                            AS payment_count,
        COUNT(DISTINCT p.record_id)::int         AS payer_count
      FROM payment p
      JOIN taxpayer_record tr USING (record_id)
      WHERE
        (${dateFrom ?? null}::date IS NULL OR p.payment_date::date >= ${dateFrom ?? null}::date)
        AND (${dateTo ?? null}::date IS NULL OR p.payment_date::date <= ${dateTo ?? null}::date)
        AND (${zoneId ?? null}::int IS NULL OR tr.zone_id = ${zoneId ?? null})
    `

    const byMethod = await sql`
      SELECT
        p.payment_method,
        COALESCE(SUM(p.amount_paid), 0)::numeric AS total,
        COUNT(*)::int                            AS count
      FROM payment p
      JOIN taxpayer_record tr USING (record_id)
      WHERE
        (${dateFrom ?? null}::date IS NULL OR p.payment_date::date >= ${dateFrom ?? null}::date)
        AND (${dateTo ?? null}::date IS NULL OR p.payment_date::date <= ${dateTo ?? null}::date)
        AND (${zoneId ?? null}::int IS NULL OR tr.zone_id = ${zoneId ?? null})
      GROUP BY p.payment_method
      ORDER BY total DESC
    `

    const dailySeries = await sql`
      SELECT
        TO_CHAR(p.payment_date::date, 'YYYY-MM-DD') AS day,
        COALESCE(SUM(p.amount_paid), 0)::numeric    AS total,
        COUNT(*)::int                                AS count
      FROM payment p
      JOIN taxpayer_record tr USING (record_id)
      WHERE p.payment_date >= COALESCE(${dateFrom ?? null}::date, NOW() - INTERVAL '30 days')
        AND p.payment_date <= COALESCE(${dateTo   ?? null}::date, NOW())
        AND (${zoneId ?? null}::int IS NULL OR tr.zone_id = ${zoneId ?? null})
      GROUP BY day
      ORDER BY day
    `

    return {
      totals: {
        totalCollected: Number(totals.totalCollected),
        paymentCount:   totals.paymentCount,
        payerCount:     totals.payerCount,
      },
      byMethod: byMethod.map((r) => ({
        method: r.paymentMethod,
        total:  Number(r.total),
        count:  r.count,
      })),
      dailySeries: dailySeries.map((r) => ({
        day: r.day, total: Number(r.total), count: r.count,
      })),
    }
  })

  // POST /api/payments/:id/reverse — the ONLY sanctioned way to correct a
  // wrongly captured payment. Creates a negative counter-entry referencing
  // the original (which is itself immutable — enforced by DB trigger), flags
  // the original as reversed, recomputes affected notice status, and logs
  // everything. Requires an elevated role and a written reason.
  fastify.post('/:id/reverse', {
    preHandler: fastify.requireRole('admin', 'finance_manager'),
    schema: {
      body: {
        type: 'object',
        required: ['reason'],
        properties: {
          reason: { type: 'string', minLength: 10, maxLength: 1000 },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params
    const { reason } = request.body
    const { userId } = request.user

    const [original] = await sql`
      SELECT payment_id, record_id, notice_id, amount_paid, payment_method,
             receipt_number, is_reversed, reverses_payment_id
      FROM payment WHERE payment_id = ${id}
    `
    if (!original) {
      return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Payment not found' })
    }
    if (original.reversesPaymentId) {
      return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'This row is itself a reversal — it cannot be reversed' })
    }
    if (original.isReversed) {
      return reply.status(409).send({ statusCode: 409, error: 'Conflict', message: 'Payment is already reversed' })
    }

    const reversalReceipt = `REV-${original.receiptNumber}`

    const result = await sql.begin(async (tx) => {
      const [reversal] = await tx`
        INSERT INTO payment (
          record_id, notice_id, amount_paid, payment_method, payment_date,
          receipt_number, recorded_by, reverses_payment_id, reversal_reason, notes
        ) VALUES (
          ${original.recordId}, ${original.noticeId}, ${-Number(original.amountPaid)},
          ${original.paymentMethod}, NOW(), ${reversalReceipt}, ${userId},
          ${original.paymentId}, ${reason},
          ${'Reversal of ' + original.receiptNumber}
        )
        RETURNING payment_id, receipt_number
      `
      // Flag the original — the freeze trigger allows exactly this change.
      await tx`
        UPDATE payment SET is_reversed = TRUE, reversal_reason = ${reason}
        WHERE payment_id = ${original.paymentId}
      `
      // Re-open the notice if the reversal makes it unpaid again.
      if (original.noticeId) {
        const [notice] = await tx`SELECT amount_due, notice_status, due_date FROM demand_notice WHERE notice_id = ${original.noticeId}`
        if (notice && notice.noticeStatus === 'paid') {
          const [{ totalPaid }] = await tx`
            SELECT COALESCE(SUM(amount_paid), 0)::numeric AS total_paid
            FROM payment WHERE notice_id = ${original.noticeId}
          `
          if (Number(totalPaid) < Number(notice.amountDue)) {
            const reopened = new Date(notice.dueDate) < new Date() ? 'overdue' : 'issued'
            await tx`UPDATE demand_notice SET notice_status = ${reopened} WHERE notice_id = ${original.noticeId}`
          }
        }
      }
      await tx`
        INSERT INTO audit_log (user_id, action, table_name, record_id, old_values, new_values, ip_address)
        VALUES (
          ${userId}, 'REVERSE_PAYMENT', 'payment', ${reversal.paymentId},
          ${JSON.stringify({ originalPaymentId: original.paymentId, receipt: original.receiptNumber, amount: original.amountPaid })},
          ${JSON.stringify({ reason, reversalReceipt })},
          ${request.ip}::inet
        )
      `
      return reversal
    })

    return reply.status(201).send({
      reversalPaymentId: result.paymentId,
      receiptNumber: result.receiptNumber,
      message: `Payment ${original.receiptNumber} reversed`,
    })
  })

  // GET /api/payments/:id — single payment receipt
  fastify.get('/:id', {
    preHandler: fastify.authenticate,
  }, async (request, reply) => {
    const [payment] = await sql`
      SELECT p.*, tr.taxpayer_name, tr.taxpayer_phone, u.name AS recorded_by_name
      FROM payment p
      JOIN taxpayer_record tr USING (record_id)
      LEFT JOIN users u ON u.user_id = p.recorded_by
      WHERE p.payment_id = ${request.params.id}
    `
    if (!payment) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Payment not found' })
    return payment
  })

  // ──────────────────────────────────────────────────────────────────────
  // Paystack integration
  // ──────────────────────────────────────────────────────────────────────

  // POST /api/payments/paystack/initialize — open a hosted-checkout session
  // for a notice and return the URL the frontend should redirect to.
  fastify.post('/paystack/initialize', {
    preHandler: fastify.authenticate,
    schema: {
      body: {
        type: 'object',
        required: ['noticeId'],
        properties: {
          noticeId: { type: 'integer' },
          email:    { type: 'string', format: 'email' },
        },
      },
    },
  }, async (request, reply) => {
    const { noticeId, email } = request.body

    const [notice] = await sql`
      SELECT
        dn.notice_id, dn.notice_number, dn.amount_due, dn.notice_status,
        dn.record_id,
        tr.taxpayer_name, tr.taxpayer_email
      FROM demand_notice dn
      JOIN taxpayer_record tr USING (record_id)
      WHERE dn.notice_id = ${noticeId}
    `
    if (!notice) {
      return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Notice not found' })
    }
    if (notice.noticeStatus === 'paid') {
      return reply.status(409).send({ statusCode: 409, error: 'Conflict', message: 'Notice is already paid' })
    }
    if (Number(notice.amountDue) <= 0) {
      return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Nothing to pay on this notice' })
    }

    const payerEmail = email
      || notice.taxpayerEmail
      || `noreply+notice-${notice.noticeId}@${process.env.PAYSTACK_NOREPLY_DOMAIN || 'revenue.local'}`

    // Reference encodes the notice id + a timestamp so a retry after a failed
    // / abandoned attempt gets its own unique reference.
    const reference = `NOTICE-${notice.noticeId}-${Date.now()}`

    try {
      const data = await paystackInit({
        email: payerEmail,
        amount: Number(notice.amountDue),
        reference,
        metadata: {
          noticeId: notice.noticeId,
          noticeNumber: notice.noticeNumber,
          recordId: notice.recordId,
          taxpayerName: notice.taxpayerName,
        },
      })

      await sql`
        INSERT INTO audit_log (user_id, action, table_name, record_id, new_values, ip_address)
        VALUES (
          ${request.user.userId},
          'PAYSTACK_INITIALIZE',
          'demand_notice',
          ${notice.noticeId},
          ${JSON.stringify({ reference, amount: notice.amountDue })},
          ${request.ip}::inet
        )
      `

      return {
        authorizationUrl: data.authorization_url,
        reference: data.reference,
      }
    } catch (err) {
      return reply
        .status(err.statusCode || 502)
        .send({ statusCode: err.statusCode || 502, error: 'Bad Gateway', message: err.message })
    }
  })

  // POST /api/payments/paystack/webhook — Paystack server-to-server callback.
  // Public route (Paystack can't carry our JWT). HMAC signature is the only
  // gate, so DO NOT trust anything until verifyWebhookSignature passes.
  fastify.post('/paystack/webhook', {
    config: { public: true },
  }, async (request, reply) => {
    const rawBody = request.rawBody ?? ''
    const signature = request.headers['x-paystack-signature']

    if (!verifyWebhookSignature(rawBody, signature)) {
      fastify.log.warn({ signature }, 'Paystack webhook signature mismatch')
      return reply.status(401).send({ statusCode: 401, error: 'Unauthorized' })
    }

    const event = request.body
    // We only care about successful charges. Acknowledge everything else 200
    // so Paystack doesn't retry forever.
    if (event?.event !== 'charge.success') {
      return reply.send({ ok: true, ignored: event?.event ?? 'unknown' })
    }

    const data = event.data ?? {}
    const reference = data.reference
    if (!reference) return reply.send({ ok: true, skipped: 'missing reference' })

    // Reference shape: NOTICE-{id}-{ts}. Anything else we can't route.
    const match = /^NOTICE-(\d+)-/.exec(reference)
    if (!match) {
      fastify.log.warn({ reference }, 'Paystack reference does not match NOTICE-* shape')
      return reply.send({ ok: true, skipped: 'unrecognized reference' })
    }
    const noticeId = Number(match[1])

    // Pull the notice (+ taxpayer + the user who generated it; we'll use that
    // user as the recorded_by since the webhook has no session).
    const [notice] = await sql`
      SELECT
        dn.notice_id, dn.notice_number, dn.record_id, dn.amount_due,
        dn.generated_by
      FROM demand_notice dn
      WHERE dn.notice_id = ${noticeId}
    `
    if (!notice) {
      fastify.log.warn({ noticeId, reference }, 'Paystack webhook for unknown notice')
      return reply.send({ ok: true, skipped: 'unknown notice' })
    }

    const amountPaid = Number(data.amount || 0) / 100 // cents → KES
    const channel = data.channel
    const paymentMethod = mapChannelToMethod(channel)
    const mpesaRef = paymentMethod === 'mpesa' ? (data.id ? String(data.id) : null) : null
    const bankRef = paymentMethod === 'bank' ? (data.id ? String(data.id) : null) : null
    const receiptNumber = `PSK-${new Date().getFullYear()}-${String(data.id ?? Date.now()).slice(-10)}`

    // INSERT is idempotent via the UNIQUE constraint on paystack_reference —
    // a retried webhook collides on the second attempt and we no-op.
    let inserted
    try {
      const rows = await sql`
        INSERT INTO payment (
          record_id, notice_id, amount_paid, payment_method,
          mpesa_ref, bank_ref, payment_date, receipt_number, recorded_by,
          paystack_reference, gateway_response, notes
        ) VALUES (
          ${notice.recordId}, ${notice.noticeId}, ${amountPaid}, ${paymentMethod},
          ${mpesaRef}, ${bankRef}, NOW(), ${receiptNumber}, ${notice.generatedBy},
          ${reference}, ${JSON.stringify(data)},
          ${'Paystack: ' + (channel ?? 'unknown channel')}
        )
        RETURNING payment_id, receipt_number
      `
      inserted = rows[0]
    } catch (err) {
      // 23505 = unique_violation → duplicate webhook, safe to ack.
      if (err.code === '23505') {
        return reply.send({ ok: true, duplicate: true, reference })
      }
      throw err
    }

    // Auto-settle the notice if the payment covers the outstanding balance.
    const [{ totalPaid }] = await sql`
      SELECT COALESCE(SUM(amount_paid), 0)::numeric AS total_paid
      FROM payment WHERE notice_id = ${notice.noticeId}
    `
    if (Number(totalPaid) >= Number(notice.amountDue)) {
      await sql`UPDATE demand_notice SET notice_status = 'paid' WHERE notice_id = ${notice.noticeId}`
    }

    await sql`
      INSERT INTO audit_log (action, table_name, record_id, new_values, ip_address)
      VALUES (
        'PAYSTACK_CHARGE_SUCCESS',
        'payment',
        ${inserted.paymentId},
        ${JSON.stringify({ reference, channel, amountPaid, noticeId: notice.noticeId })},
        ${request.ip}::inet
      )
    `

    return reply.send({ ok: true, paymentId: inserted.paymentId, receiptNumber: inserted.receiptNumber })
  })

  // GET /api/payments/paystack/verify/:reference — defensive: the frontend
  // calls this when Paystack redirects the user back, in case the webhook is
  // delayed. If the payment already landed (webhook beat us here), report it.
  // If not yet, hit Paystack's verify endpoint and, on success, record the
  // payment via the same path the webhook uses.
  fastify.get('/paystack/verify/:reference', {
    preHandler: fastify.authenticate,
  }, async (request, reply) => {
    const { reference } = request.params

    const [existing] = await sql`
      SELECT p.payment_id, p.receipt_number, p.amount_paid, p.notice_id, p.gateway_response
      FROM payment p
      WHERE p.paystack_reference = ${reference}
    `
    if (existing) {
      return { status: 'already_recorded', payment: existing }
    }

    let data
    try {
      data = await paystackVerify(reference)
    } catch (err) {
      return reply
        .status(err.statusCode || 502)
        .send({ statusCode: err.statusCode || 502, error: 'Bad Gateway', message: err.message })
    }

    if (data?.status !== 'success') {
      return { status: data?.status || 'unknown', message: data?.gateway_response || 'Not yet successful' }
    }

    // Same routing logic as the webhook handler.
    const match = /^NOTICE-(\d+)-/.exec(reference)
    if (!match) return { status: 'unrouteable' }
    const noticeId = Number(match[1])

    const [notice] = await sql`
      SELECT dn.notice_id, dn.record_id, dn.amount_due, dn.generated_by
      FROM demand_notice dn WHERE dn.notice_id = ${noticeId}
    `
    if (!notice) return { status: 'notice_not_found' }

    const amountPaid = Number(data.amount || 0) / 100
    const channel = data.channel
    const paymentMethod = mapChannelToMethod(channel)
    const mpesaRef = paymentMethod === 'mpesa' ? (data.id ? String(data.id) : null) : null
    const bankRef = paymentMethod === 'bank' ? (data.id ? String(data.id) : null) : null
    const receiptNumber = `PSK-${new Date().getFullYear()}-${String(data.id ?? Date.now()).slice(-10)}`

    try {
      const [row] = await sql`
        INSERT INTO payment (
          record_id, notice_id, amount_paid, payment_method,
          mpesa_ref, bank_ref, payment_date, receipt_number, recorded_by,
          paystack_reference, gateway_response, notes
        ) VALUES (
          ${notice.recordId}, ${notice.noticeId}, ${amountPaid}, ${paymentMethod},
          ${mpesaRef}, ${bankRef}, NOW(), ${receiptNumber}, ${notice.generatedBy},
          ${reference}, ${JSON.stringify(data)},
          ${'Paystack (verify): ' + (channel ?? 'unknown channel')}
        )
        RETURNING payment_id, receipt_number
      `
      const [{ totalPaid }] = await sql`
        SELECT COALESCE(SUM(amount_paid), 0)::numeric AS total_paid
        FROM payment WHERE notice_id = ${notice.noticeId}
      `
      if (Number(totalPaid) >= Number(notice.amountDue)) {
        await sql`UPDATE demand_notice SET notice_status = 'paid' WHERE notice_id = ${notice.noticeId}`
      }
      return { status: 'recorded', payment: row }
    } catch (err) {
      if (err.code === '23505') return { status: 'already_recorded' }
      throw err
    }
  })
}
