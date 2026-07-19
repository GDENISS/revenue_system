// src/routes/tasks.js
// Field data-collection tasks: a GIS officer (or admin) assigns "capture the
// spatial data for record X" to a field officer, who collects it with ArcGIS
// Field Maps / Survey123. Tasks auto-complete when the record gains its
// arcgis_object_id (see closeTasksForRecord, called from the link endpoint
// and the sync upsert).
import { getDb } from '../db.js'

/**
 * Build deep links into the Esri field apps for a given record. Best-effort:
 * links are only produced when the corresponding env var is configured.
 *   SURVEY123_FORM_ITEM_ID  — the Survey123 form's portal item id
 *   FIELDMAPS_MAP_ITEM_ID   — the web map item id used by Field Maps
 */
function fieldAppLinks(record) {
  const links = {}
  const surveyId = process.env.SURVEY123_FORM_ITEM_ID?.trim()
  const mapId = process.env.FIELDMAPS_MAP_ITEM_ID?.trim()
  if (surveyId) {
    const params = new URLSearchParams()
    // Prefill commonly-named survey fields; harmless if the form lacks them.
    if (record.taxpayerName) params.set('field:taxpayer_name', record.taxpayerName)
    if (record.recordId) params.set('field:record_id', String(record.recordId))
    links.survey123 = `https://survey123.arcgis.app/?itemID=${surveyId}&${params.toString()}`
  }
  if (mapId) {
    links.fieldMaps = `https://fieldmaps.arcgis.app/?itemID=${mapId}`
  }
  return links
}

/** Mark active capture tasks done when a record acquires spatial data. */
export async function closeTasksForRecord(sql, recordId) {
  return sql`
    UPDATE field_task
    SET status = 'done', completed_at = NOW(), updated_at = NOW()
    WHERE record_id = ${recordId}
      AND task_type = 'spatial_capture'
      AND status IN ('open', 'in_progress')
    RETURNING task_id
  `
}

export default async function taskRoutes(fastify) {
  const sql = getDb()

  // POST /api/tasks — assign a capture task (GIS officer or admin)
  fastify.post('/', {
    preHandler: fastify.requireRole('admin', 'gis_officer'),
    schema: {
      body: {
        type: 'object',
        required: ['recordId', 'assignedTo'],
        properties: {
          recordId:     { type: 'integer' },
          assignedTo:   { type: 'integer' },
          priority:     { type: 'string', enum: ['low', 'normal', 'high'], default: 'normal' },
          instructions: { type: 'string', maxLength: 2000 },
          dueDate:      { type: 'string', format: 'date' },
        },
      },
    },
  }, async (request, reply) => {
    const { recordId, assignedTo, priority = 'normal', instructions, dueDate } = request.body
    const { userId } = request.user

    const [record] = await sql`
      SELECT record_id, taxpayer_name, arcgis_object_id
      FROM taxpayer_record WHERE record_id = ${recordId}
    `
    if (!record) {
      return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Record not found' })
    }
    if (record.arcgisObjectId != null) {
      return reply.status(409).send({
        statusCode: 409,
        error: 'Conflict',
        message: 'Record already has spatial data — nothing to capture',
      })
    }

    const [assignee] = await sql`
      SELECT u.user_id, u.name, r.role_name
      FROM users u JOIN role r USING (role_id)
      WHERE u.user_id = ${assignedTo}
    `
    if (!assignee) {
      return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Assignee not found' })
    }

    // Upsert-style: if an active task already exists for this record, reassign
    // it instead of violating the partial unique index.
    const [existing] = await sql`
      SELECT task_id FROM field_task
      WHERE record_id = ${recordId} AND task_type = 'spatial_capture'
        AND status IN ('open', 'in_progress')
    `
    let task
    if (existing) {
      ;[task] = await sql`
        UPDATE field_task
        SET assigned_to = ${assignedTo}, assigned_by = ${userId},
            priority = ${priority}, instructions = ${instructions ?? null},
            due_date = ${dueDate ?? null}, status = 'open', updated_at = NOW()
        WHERE task_id = ${existing.taskId}
        RETURNING task_id, record_id, status
      `
    } else {
      ;[task] = await sql`
        INSERT INTO field_task (record_id, assigned_to, assigned_by, priority, instructions, due_date)
        VALUES (${recordId}, ${assignedTo}, ${userId}, ${priority}, ${instructions ?? null}, ${dueDate ?? null})
        RETURNING task_id, record_id, status
      `
    }

    await sql`
      INSERT INTO audit_log (user_id, action, table_name, record_id, new_values, ip_address)
      VALUES (${userId}, 'ASSIGN_FIELD_TASK', 'field_task', ${task.taskId},
              ${JSON.stringify({ recordId, assignedTo, priority })}, ${request.ip}::inet)
    `

    return reply.status(201).send({
      taskId: task.taskId,
      reassigned: !!existing,
      message: existing
        ? `Task reassigned to ${assignee.name}`
        : `Task assigned to ${assignee.name}`,
    })
  })

  // GET /api/tasks — list tasks. Field officers see their own; GIS officers,
  // finance managers and admins see everything (filterable).
  fastify.get('/', {
    preHandler: fastify.authenticate,
    schema: {
      querystring: {
        type: 'object',
        properties: {
          status:     { type: 'string' },
          assignedTo: { type: 'integer' },
          recordId:   { type: 'integer' },
          mine:       { type: 'boolean' },
        },
      },
    },
  }, async (request) => {
    const { role, userId } = request.user
    const { status, assignedTo, recordId, mine } = request.query
    // Plain officers are always scoped to their own tasks.
    const scopeToUser = role === 'officer' || mine ? userId : (assignedTo ?? null)

    const tasks = await sql`
      SELECT
        ft.*,
        tr.taxpayer_name,
        tr.arcgis_object_id,
        z.zone_name,
        rt.type_name AS record_type,
        ua.name AS assigned_to_name,
        ub.name AS assigned_by_name
      FROM field_task ft
      JOIN taxpayer_record tr USING (record_id)
      JOIN zone z ON z.zone_id = tr.zone_id
      JOIN record_type rt ON rt.record_type_id = tr.record_type_id
      JOIN users ua ON ua.user_id = ft.assigned_to
      JOIN users ub ON ub.user_id = ft.assigned_by
      WHERE
        (${scopeToUser}::int IS NULL OR ft.assigned_to = ${scopeToUser})
        AND (${status ?? null}::text IS NULL OR ft.status = ${status ?? null})
        AND (${recordId ?? null}::int IS NULL OR ft.record_id = ${recordId ?? null})
      ORDER BY
        CASE ft.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
        ft.due_date ASC NULLS LAST,
        ft.created_at DESC
    `

    return {
      data: tasks.map((t) => ({
        ...t,
        links: fieldAppLinks({ recordId: t.recordId, taxpayerName: t.taxpayerName }),
      })),
    }
  })

  // PATCH /api/tasks/:id/status — assignee moves their task along; GIS
  // officer/admin can also cancel or reopen.
  fastify.patch('/:id/status', {
    preHandler: fastify.authenticate,
    schema: {
      body: {
        type: 'object',
        required: ['status'],
        properties: {
          status: { type: 'string', enum: ['open', 'in_progress', 'done', 'cancelled'] },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params
    const { status } = request.body
    const { userId, role } = request.user

    const [task] = await sql`SELECT task_id, assigned_to, status FROM field_task WHERE task_id = ${id}`
    if (!task) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'Task not found' })

    const isPrivileged = role === 'admin' || role === 'gis_officer'
    if (!isPrivileged && task.assignedTo !== userId) {
      return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Not your task' })
    }
    // Only privileged roles can cancel or reopen a finished task.
    if (!isPrivileged && (status === 'cancelled' || task.status === 'done')) {
      return reply.status(403).send({ statusCode: 403, error: 'Forbidden', message: 'Only a GIS officer can do that' })
    }

    const [updated] = await sql`
      UPDATE field_task
      SET status = ${status},
          completed_at = ${status === 'done' ? sql`NOW()` : null},
          updated_at = NOW()
      WHERE task_id = ${id}
      RETURNING task_id, status
    `

    await sql`
      INSERT INTO audit_log (user_id, action, table_name, record_id, new_values, ip_address)
      VALUES (${userId}, 'UPDATE_FIELD_TASK', 'field_task', ${id},
              ${JSON.stringify({ status })}, ${request.ip}::inet)
    `

    return { taskId: updated.taskId, status: updated.status }
  })

  // GET /api/tasks/assignees — users a task can be assigned to (officers +
  // gis officers). Used by the assignment modal's dropdown.
  fastify.get('/assignees', {
    preHandler: fastify.requireRole('admin', 'gis_officer'),
  }, async () => {
    const assignees = await sql`
      SELECT u.user_id, u.name, r.role_name, z.zone_name
      FROM users u
      JOIN role r USING (role_id)
      LEFT JOIN zone z ON z.zone_id = u.zone_id
      WHERE r.role_name IN ('officer', 'gis_officer') AND COALESCE(u.is_active, TRUE)
      ORDER BY u.name
    `
    return { data: assignees }
  })
}
