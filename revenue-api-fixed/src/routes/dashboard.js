// src/routes/dashboard.js
import { getDb } from '../db.js'

export default async function dashboardRoutes(fastify) {
  const sql = getDb()

  // GET /api/dashboard — main KPI summary
  fastify.get('/', {
    preHandler: fastify.authenticate,
  }, async (request) => {
    const { zoneId, billingYear = new Date().getFullYear(), dateFrom, dateTo } = request.query
    const { role, zoneId: userZoneId } = request.user
    // postgres.js refuses undefined — coalesce the whole expression
    const effectiveZoneId = (role === 'officer' ? userZoneId : zoneId) ?? null
    const trendFrom = dateFrom ?? null
    const trendTo   = dateTo   ?? null

    const [recordTotals] = await sql`
      SELECT
        COUNT(*)::int AS total_records,
        COUNT(*) FILTER (WHERE status_id = 2)::int AS active_records,
        COUNT(*) FILTER (WHERE status_id = 1)::int AS pending_records
      FROM taxpayer_record
      WHERE (${effectiveZoneId}::int IS NULL OR zone_id = ${effectiveZoneId})
    `

    // ── BILLABLE POTENTIAL (informational) ────────────────────────────
    // This CTE is ONLY used for the "billable vs unbilled records" counts
    // and a schedule-theoretical ceiling. It is NOT the target — the real
    // expected revenue is the actual billed total computed further down.
    //
    //   billablePotential = Σ (applicable fee schedule amount for every
    //                          ACTIVE/pending record in scope)
    //
    // Schedule lookup follows the hierarchical zone match:
    //   1. Most-specific zone match (fs.zone_id = tr.zone_id)
    //   2. Default rule (fs.zone_id IS NULL)
    //   3. Most recent `effective_from`
    //
    // Records with no matching active schedule contribute 0 and are
    // counted as "unbilled".
    const expectedRows = await sql`
      WITH active_records AS (
        SELECT tr.record_id, tr.record_type_id, tr.zone_id
        FROM taxpayer_record tr
        WHERE tr.status_id IN (1, 2)        -- pending or active
          AND (${effectiveZoneId}::int IS NULL OR tr.zone_id = ${effectiveZoneId})
      ),
      record_fees AS (
        SELECT
          ar.record_id,
          ar.zone_id,
          (
            SELECT fs.amount
            FROM fee_schedule fs
            WHERE fs.record_type_id = ar.record_type_id
              AND fs.is_active = TRUE
              AND (fs.zone_id IS NULL OR fs.zone_id = ar.zone_id)
              AND fs.effective_from <= CURRENT_DATE
              AND (fs.effective_to IS NULL OR fs.effective_to >= CURRENT_DATE)
            ORDER BY
              (fs.zone_id IS NOT NULL) DESC,
              fs.effective_from DESC
            LIMIT 1
          )::numeric AS applicable_amount
        FROM active_records ar
      )
      SELECT
        COALESCE(SUM(applicable_amount), 0)::numeric              AS billable_potential,
        COUNT(*) FILTER (WHERE applicable_amount IS NOT NULL)::int AS billable_records,
        COUNT(*) FILTER (WHERE applicable_amount IS NULL)::int     AS unbilled_records
      FROM record_fees
    `
    // Schedule-theoretical potential: what *could* be billed if every active
    // record had its schedule applied. Informational only — NOT the target.
    const billablePotential = Number(expectedRows[0]?.billablePotential ?? 0)
    const billableRecords   = expectedRows[0]?.billableRecords ?? 0
    const unbilledRecords   = expectedRows[0]?.unbilledRecords ?? 0

    // ── ONE COHERENT LEDGER ───────────────────────────────────────────
    // Everything below is actual, all-time, zone-scoped, and reconciles:
    //
    //     expectedRevenue = totalBilled               (what we've billed)
    //     totalOutstanding = totalBilled − totalCollected   (never < 0)
    //     => expectedRevenue = totalCollected + totalOutstanding
    //     collectionRate    = totalCollected / totalBilled × 100
    //
    // These are the same numbers the records list / detail show, so the
    // dashboard, the rows and the record view always agree.

    // Actual obligations raised (every unwaived fee_assignment, any year).
    const [billedRow] = await sql`
      SELECT COALESCE(SUM(fa.amount_due), 0)::numeric AS total_billed
      FROM fee_assignment fa
      JOIN taxpayer_record tr USING (record_id)
      WHERE fa.is_waived = FALSE
        AND (${effectiveZoneId}::int IS NULL OR tr.zone_id = ${effectiveZoneId})
    `
    const totalBilled = Number(billedRow.totalBilled)

    // All money received (any date).
    const [collectedRow] = await sql`
      SELECT COALESCE(SUM(p.amount_paid), 0)::numeric AS total_collected
      FROM payment p
      JOIN taxpayer_record tr USING (record_id)
      WHERE (${effectiveZoneId}::int IS NULL OR tr.zone_id = ${effectiveZoneId})
    `
    const totalCollected = Number(collectedRow.totalCollected)

    // Outstanding = what's owed on the books. Identical to Σ of each
    // record's Outstanding column.
    const totalOutstanding = Math.max(0, totalBilled - totalCollected)

    // Expected revenue now *is* the billed total — it explicitly contains
    // the outstanding balance (expected = collected + outstanding).
    const expectedRevenue = totalBilled

    // Of what we have billed, how much have we collected (0–100, can nudge
    // past 100 only on over-payment which the hero card clamps + flags).
    const collectionRate = totalBilled > 0
      ? (totalCollected / totalBilled) * 100
      : 0

    const totals = {
      ...recordTotals,
      expectedRevenue,        // = totalBilled = collected + outstanding
      billablePotential,      // schedule-theoretical ceiling (informational)
      billableRecords,
      unbilledRecords,
      totalBilled,
      totalCollected,
      totalOutstanding,
    }

    const [{ noticeCount, paidNotices }] = await sql`
      SELECT
        COUNT(*)::int AS notice_count,
        COUNT(*) FILTER (WHERE dn.notice_status = 'paid')::int AS paid_notices
      FROM demand_notice dn
      JOIN taxpayer_record tr USING (record_id)
      WHERE EXTRACT(YEAR FROM dn.issued_date) = ${billingYear}
        AND (${effectiveZoneId}::int IS NULL OR tr.zone_id = ${effectiveZoneId})
    `

    // Collection trend. Window is the caller-supplied dateFrom/dateTo (the
    // dashboard's date-range filter); falls back to last 12 months.
    // Granularity auto-adapts: ≤ 31 days → daily buckets, otherwise monthly.
    const trendDays =
      trendFrom && trendTo
        ? Math.max(
            1,
            Math.round(
              (new Date(trendTo).getTime() - new Date(trendFrom).getTime()) /
                86_400_000,
            ),
          )
        : 365
    const bucketFmt = trendDays <= 31 ? 'YYYY-MM-DD' : 'YYYY-MM'

    // Use positional GROUP BY / ORDER BY so the bucket-format parameter only
    // appears once in the SQL — otherwise the planner sees two distinct
    // parameterised expressions and rejects the GROUP BY.
    const monthlyTrend = await sql`
      SELECT
        TO_CHAR(payment_date, ${bucketFmt}) AS month,
        SUM(amount_paid)::numeric AS collected,
        COUNT(*)::int AS payment_count
      FROM payment p
      JOIN taxpayer_record tr USING (record_id)
      WHERE (${trendFrom}::date IS NULL OR payment_date >= ${trendFrom}::date)
        AND (${trendTo}::date   IS NULL OR payment_date <  ${trendTo}::date + INTERVAL '1 day')
        AND (${trendFrom}::date IS NOT NULL OR payment_date >= NOW() - INTERVAL '12 months')
        AND (${effectiveZoneId}::int IS NULL OR tr.zone_id = ${effectiveZoneId})
      GROUP BY 1
      ORDER BY 1
    `

    // Revenue by record type
    const byRecordType = await sql`
      SELECT
        rt.type_name,
        COUNT(DISTINCT tr.record_id)::int AS record_count,
        COALESCE((
          SELECT SUM(fa.amount_due)
          FROM fee_assignment fa
          JOIN taxpayer_record t USING (record_id)
          WHERE t.record_type_id = rt.record_type_id
            AND fa.is_waived = FALSE
            AND (${effectiveZoneId}::int IS NULL OR t.zone_id = ${effectiveZoneId})
        ), 0)::numeric AS billed,
        COALESCE((
          SELECT SUM(p.amount_paid)
          FROM payment p
          JOIN taxpayer_record t USING (record_id)
          WHERE t.record_type_id = rt.record_type_id
            AND (${effectiveZoneId}::int IS NULL OR t.zone_id = ${effectiveZoneId})
        ), 0)::numeric AS collected
      FROM record_type rt
      LEFT JOIN taxpayer_record tr ON tr.record_type_id = rt.record_type_id
        AND (${effectiveZoneId}::int IS NULL OR tr.zone_id = ${effectiveZoneId})
      GROUP BY rt.record_type_id, rt.type_name
      ORDER BY collected DESC
    `

    // Revenue by zone (top 10)
    const byZone = await sql`
      SELECT
        z.zone_name,
        z.zone_id,
        COUNT(DISTINCT tr.record_id)::int AS record_count,
        COALESCE((
          SELECT SUM(fa.amount_due)
          FROM fee_assignment fa
          JOIN taxpayer_record t USING (record_id)
          WHERE t.zone_id = z.zone_id
            AND fa.is_waived = FALSE
        ), 0)::numeric AS billed,
        COALESCE((
          SELECT SUM(p.amount_paid)
          FROM payment p
          JOIN taxpayer_record t USING (record_id)
          WHERE t.zone_id = z.zone_id
        ), 0)::numeric AS collected
      FROM zone z
      LEFT JOIN taxpayer_record tr ON tr.zone_id = z.zone_id
      WHERE (${effectiveZoneId}::int IS NULL OR z.zone_id = ${effectiveZoneId})
      GROUP BY z.zone_name, z.zone_id
      ORDER BY collected DESC
      LIMIT 10
    `

    // Recent activity
    const recentActivity = await sql`
      SELECT
        al.log_id,
        al.action,
        al.created_at,
        u.name AS user_name
      FROM audit_log al
      LEFT JOIN users u USING (user_id)
      ORDER BY al.created_at DESC
      LIMIT 20
    `

    return {
      summary: {
        ...totals,
        noticeCount,
        paidNotices,
        // Collection rate is now anchored to EXPECTED revenue (sum of
        // applicable fee schedules × active records). It is naturally
        // bounded between 0–100% when payments don't exceed the target.
        collectionRate: collectionRate.toFixed(1),
      },
      monthlyTrend,
      byRecordType,
      byZone,
      recentActivity,
      billingYear,
    }
  })

  // GET /api/dashboard/sync-status — ArcGIS sync status
  fastify.get('/sync-status', {
    preHandler: fastify.requireRole('admin', 'finance_manager'),
  }, async () => {
    const [config] = await sql`
      SELECT last_sync_at, sync_interval_minutes, is_active, last_sync_error
      FROM arcgis_config LIMIT 1
    `
    const [{ synced }] = await sql`SELECT COUNT(*)::int AS synced FROM taxpayer_record WHERE arcgis_object_id IS NOT NULL`
    const [{ total }] = await sql`SELECT COUNT(*)::int AS total FROM taxpayer_record`

    return {
      lastSyncAt: config?.lastSyncAt ?? null,
      syncIntervalMinutes: config?.syncIntervalMinutes ?? 15,
      isActive: config?.isActive ?? false,
      lastSyncError: config?.lastSyncError ?? null,
      arcgisSyncedRecords: synced,
      manualRecords: total - synced,
      totalRecords: total,
    }
  })
}
