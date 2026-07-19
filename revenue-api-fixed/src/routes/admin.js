// src/routes/admin.js
import { getDb } from '../db.js'
import {
  syncArcGIS,
  createArcGISLayers,
  resolveCredentials,
  getArcGISToken,
} from '../services/arcgis-sync.js'

export default async function adminRoutes(fastify) {
  const sql = getDb()

  // ── Users ────────────────────────────────────────────────────────────────

  // GET /api/admin/users
  fastify.get('/users', {
    preHandler: fastify.requireRole('admin'),
  }, async () => {
    return sql`
      SELECT u.user_id, u.name, u.email, r.role_name AS role, z.zone_name,
             u.is_active, u.last_login_at, u.created_at
      FROM users u
      JOIN role r USING (role_id)
      LEFT JOIN zone z USING (zone_id)
      ORDER BY u.created_at DESC
    `
  })

  // POST /api/admin/users
  fastify.post('/users', {
    preHandler: fastify.requireRole('admin'),
    schema: {
      body: {
        type: 'object',
        required: ['fullName', 'email', 'password', 'roleName'],
        properties: {
          fullName: { type: 'string' },
          email:    { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 8 },
          roleName: { type: 'string', enum: ['admin', 'finance_manager', 'officer', 'gis_officer'] },
          zoneId:   { type: 'integer' },
        },
      },
    },
  }, async (request, reply) => {
    const { fullName, email, password, roleName, zoneId } = request.body

    const [role] = await sql`SELECT role_id FROM role WHERE role_name = ${roleName}`
    if (!role) return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid role' })

    const [existing] = await sql`SELECT user_id FROM users WHERE email = ${email.toLowerCase()}`
    if (existing) return reply.status(409).send({ statusCode: 409, error: 'Conflict', message: 'Email already exists' })

    const [user] = await sql`
      INSERT INTO users (name, email, password_hash, role_id, zone_id)
      VALUES (${fullName}, ${email.toLowerCase()}, crypt(${password}, gen_salt('bf')), ${role.roleId}, ${zoneId ?? null})
      RETURNING user_id
    `

    await sql`
      INSERT INTO audit_log (user_id, action, table_name, record_id, ip_address)
      VALUES (${request.user.userId}, 'CREATE_USER', 'users', ${user.userId}, ${request.ip}::inet)
    `

    return reply.status(201).send({ userId: user.userId, message: 'User created successfully' })
  })

  // PATCH /api/admin/users/:id
  fastify.patch('/users/:id', {
    preHandler: fastify.requireRole('admin'),
    schema: {
      body: {
        type: 'object',
        properties: {
          fullName:  { type: 'string' },
          isActive:  { type: 'boolean' },
          roleName:  { type: 'string', enum: ['admin', 'finance_manager', 'officer', 'gis_officer'] },
          zoneId:    { type: 'integer' },
        },
      },
    },
  }, async (request, reply) => {
    const { id } = request.params
    const { fullName, isActive, roleName, zoneId } = request.body

    let roleId = null
    if (roleName) {
      const [role] = await sql`SELECT role_id FROM role WHERE role_name = ${roleName}`
      if (!role) {
        return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: 'Invalid role' })
      }
      roleId = role.roleId
    }

    const [result] = await sql`
      UPDATE users SET
        name = COALESCE(${fullName ?? null}, name),
        is_active = COALESCE(${isActive ?? null}, is_active),
        role_id   = COALESCE(${roleId}::int, role_id),
        zone_id   = COALESCE(${zoneId ?? null}::int, zone_id)
      WHERE user_id = ${id}
      RETURNING user_id
    `

    if (!result) return reply.status(404).send({ statusCode: 404, error: 'Not Found', message: 'User not found' })

    return { message: 'User updated' }
  })

  // ── ArcGIS Config ────────────────────────────────────────────────────────

  // GET /api/admin/arcgis
  fastify.get('/arcgis', {
    preHandler: fastify.requireRole('admin'),
  }, async () => {
    const [config] = await sql`
      SELECT config_id, base_url, client_id, parcel_layer_id,
             business_layer_id, market_stall_layer_id, sync_interval_minutes,
             last_sync_at, is_active
      FROM arcgis_config LIMIT 1
    `
    return config ?? {}
  })

  // PUT /api/admin/arcgis
  fastify.put('/arcgis', {
    preHandler: fastify.requireRole('admin'),
    schema: {
      body: {
        type: 'object',
        required: ['baseUrl', 'clientId', 'clientSecret'],
        properties: {
          baseUrl:              { type: 'string' },
          clientId:             { type: 'string' },
          clientSecret:         { type: 'string' },
          parcelLayerId:        { type: 'string' },
          businessLayerId:      { type: 'string' },
          marketStallLayerId:   { type: 'string' },
          syncIntervalMinutes:  { type: 'integer', minimum: 5, maximum: 1440 },
          isActive:             { type: 'boolean' },
        },
      },
    },
  }, async (request, reply) => {
    const {
      baseUrl, clientId, clientSecret, parcelLayerId, businessLayerId,
      marketStallLayerId, syncIntervalMinutes = 15, isActive = true,
    } = request.body

    const [existing] = await sql`SELECT config_id FROM arcgis_config LIMIT 1`

    if (existing) {
      await sql`
        UPDATE arcgis_config SET
          base_url = ${baseUrl},
          client_id = ${clientId},
          client_secret_enc = ${clientSecret},
          parcel_layer_id = ${parcelLayerId ?? null},
          business_layer_id = ${businessLayerId ?? null},
          market_stall_layer_id = ${marketStallLayerId ?? null},
          sync_interval_minutes = ${syncIntervalMinutes},
          is_active = ${isActive}
        WHERE config_id = ${existing.configId}
      `
    } else {
      await sql`
        INSERT INTO arcgis_config
          (base_url, client_id, client_secret_enc, parcel_layer_id, business_layer_id, market_stall_layer_id, sync_interval_minutes, is_active)
        VALUES
          (${baseUrl}, ${clientId}, ${clientSecret}, ${parcelLayerId ?? null}, ${businessLayerId ?? null}, ${marketStallLayerId ?? null}, ${syncIntervalMinutes}, ${isActive})
      `
    }

    return { message: 'ArcGIS configuration saved' }
  })

  // GET /api/admin/audit-log
  fastify.get('/audit-log', {
    preHandler: fastify.requireRole('admin', 'finance_manager'),
    schema: {
      querystring: {
        type: 'object',
        properties: {
          page:     { type: 'integer', default: 1 },
          limit:    { type: 'integer', default: 50, maximum: 200 },
          userId:   { type: 'integer' },
          action:   { type: 'string' },
          dateFrom: { type: 'string', format: 'date' },
          dateTo:   { type: 'string', format: 'date' },
        },
      },
    },
  }, async (request) => {
    const { page = 1, limit = 50, userId, action, dateFrom, dateTo } = request.query
    const offset = (page - 1) * limit

    const logs = await sql`
      SELECT al.*, u.name AS user_name
      FROM audit_log al
      LEFT JOIN users u USING (user_id)
      WHERE
        (${userId ?? null}::int IS NULL OR al.user_id = ${userId ?? null})
        AND (${action ?? null}::text IS NULL OR al.action = ${action ?? null})
        AND (${dateFrom ?? null}::date IS NULL OR al.created_at::date >= ${dateFrom ?? null}::date)
        AND (${dateTo ?? null}::date IS NULL OR al.created_at::date <= ${dateTo ?? null}::date)
      ORDER BY al.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `

    const [{ total }] = await sql`SELECT COUNT(*)::int AS total FROM audit_log`

    return { data: logs, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } }
  })

  // ── ArcGIS sync triggers ────────────────────────────────────────────────

  // POST /api/admin/arcgis/sync — kick off sync immediately
  fastify.post('/arcgis/sync', {
    preHandler: fastify.requireRole('admin'),
  }, async (request, reply) => {
    try {
      const result = await syncArcGIS(fastify.log)
      await sql`
        INSERT INTO audit_log (user_id, action, table_name)
        VALUES (${request.user.userId}, 'ARCGIS_MANUAL_SYNC', 'arcgis_config')
      `
      return {
        message: result
          ? `Sync complete — ${result.totalInserted} inserted, ${result.totalUpdated} updated.`
          : 'Sync skipped (no config or mock mode).',
        ...(result ?? {}),
      }
    } catch (err) {
      return reply.status(500).send({
        statusCode: 500,
        error: 'Sync failed',
        message: err.message,
      })
    }
  })

  // POST /api/admin/arcgis/create-layers — bootstrap feature services
  fastify.post('/arcgis/create-layers', {
    preHandler: fastify.requireRole('admin'),
  }, async (request, reply) => {
    try {
      const results = await createArcGISLayers(fastify.log)
      return { results }
    } catch (err) {
      return reply.status(500).send({
        statusCode: 500,
        error: 'Layer creation failed',
        message: err.message,
      })
    }
  })

  // GET /api/admin/arcgis/layers/active — list the layers currently attached
  // to record types, resolved to FeatureServer URLs the map can consume.
  // Available to ALL authenticated users (map view needs it).
  fastify.get('/arcgis/layers/active', {
    preHandler: fastify.authenticate,
  }, async (request, reply) => {
    const [config] = await sql`SELECT * FROM arcgis_config LIMIT 1`
    if (!config) return { layers: [] }

    const slots = [
      { recordType: 'Parcel',       itemId: config.parcelLayerId },
      { recordType: 'Business',     itemId: config.businessLayerId },
      { recordType: 'Market Stall', itemId: config.marketStallLayerId },
    ].filter((s) => s.itemId)

    if (slots.length === 0) return { layers: [] }

    try {
      const { clientId, clientSecret, baseUrl } = resolveCredentials(config)
      const token = await getArcGISToken(baseUrl, clientId, clientSecret)

      const recordTypes = await sql`SELECT record_type_id, type_name FROM record_type`
      const typeIdByName = Object.fromEntries(
        recordTypes.map((r) => [r.typeName, r.recordTypeId]),
      )

      const layers = []
      const serverHosts = new Set()
      for (const slot of slots) {
        try {
          const itemRes = await fetch(
            `${baseUrl}/sharing/rest/content/items/${slot.itemId}?f=json&token=${token}`,
          )
          const item = await itemRes.json()
          if (item.error || !item.url) continue

          const serviceUrl = String(item.url).replace(/\/+$/, '')
          const layerUrl = /\/\d+$/.test(serviceUrl) ? serviceUrl : `${serviceUrl}/0`

          // Track the service host so the browser can register the token against it
          try {
            const u = new URL(serviceUrl)
            serverHosts.add(`${u.protocol}//${u.host}`)
          } catch {
            /* ignore */
          }

          // Pull lightweight metadata so the client knows the geometry type +
          // extent + feature count for the sidebar count badge.
          let geometryType = null
          let objectIdField = 'OBJECTID'
          let extent = null
          let featureCount = null
          try {
            const layerRes = await fetch(`${layerUrl}?f=json&token=${token}`)
            const layerMeta = await layerRes.json()
            geometryType = layerMeta.geometryType ?? null
            objectIdField = layerMeta.objectIdField ?? 'OBJECTID'
            extent = layerMeta.extent ?? null
          } catch {
            /* metadata is best-effort */
          }
          try {
            const countRes = await fetch(
              `${layerUrl}/query?where=1=1&returnCountOnly=true&f=json&token=${token}`,
            )
            const countData = await countRes.json()
            featureCount = typeof countData?.count === 'number' ? countData.count : null
          } catch {
            /* count is best-effort */
          }

          layers.push({
            recordType: slot.recordType,
            recordTypeId: typeIdByName[slot.recordType] ?? null,
            itemId: slot.itemId,
            title: item.title,
            serviceUrl,
            layerUrl,
            geometryType,
            objectIdField,
            extent,
            featureCount,
          })
        } catch (err) {
          fastify.log.warn({ err, slot }, 'failed to resolve attached layer')
        }
      }

      // Bundle the OAuth token so the browser can register it with esriId for
      // private-layer access. The token is the backend's app token (not user
      // credentials) and is short-lived.
      return {
        layers,
        auth: layers.length
          ? {
              token,
              servers: [...serverHosts, `${baseUrl}/sharing/rest`],
              // ArcGIS app tokens default to ~2h; conservative client expiry
              expiresAt: Date.now() + 90 * 60_000,
            }
          : null,
      }
    } catch (err) {
      return reply.status(500).send({
        statusCode: 500,
        error: 'Resolve failed',
        message: err.message,
      })
    }
  })

  // GET /api/admin/arcgis/layers/search — list feature services in the ArcGIS account
  fastify.get('/arcgis/layers/search', {
    preHandler: fastify.requireRole('admin'),
    schema: {
      querystring: {
        type: 'object',
        properties: {
          q:        { type: 'string' },
          owner:    { type: 'string' },
          mineOnly: { type: 'boolean', default: true },
        },
      },
    },
  }, async (request, reply) => {
    const [config] = await sql`SELECT * FROM arcgis_config LIMIT 1`
    if (!config) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Save ArcGIS configuration first.',
      })
    }

    try {
      const { clientId, clientSecret, baseUrl } = resolveCredentials(config)
      const token = await getArcGISToken(baseUrl, clientId, clientSecret)

      // Resolve the owner — the OAuth app's username unless explicitly overridden
      let owner = request.query.owner
      if (!owner && request.query.mineOnly !== false) {
        const selfRes = await fetch(
          `${baseUrl}/sharing/rest/community/self?f=json&token=${token}`,
        )
        const selfData = await selfRes.json()
        owner = selfData.username
      }

      const q = (request.query.q || '').trim()
      const queryParts = ['type:"Feature Service"']
      if (owner) queryParts.push(`owner:${owner}`)
      if (q) queryParts.push(`(title:${q}* OR snippet:${q}* OR tags:${q})`)

      const url = new URL(`${baseUrl}/sharing/rest/search`)
      url.searchParams.set('q', queryParts.join(' AND '))
      url.searchParams.set('num', '50')
      url.searchParams.set('sortField', 'modified')
      url.searchParams.set('sortOrder', 'desc')
      url.searchParams.set('f', 'json')
      url.searchParams.set('token', token)

      const res = await fetch(url.toString())
      const data = await res.json()
      if (data.error) throw new Error(data.error.message)

      const items = (data.results || []).map((r) => ({
        itemId:    r.id,
        title:     r.title,
        type:      r.type,
        owner:     r.owner,
        modified:  r.modified,
        snippet:   r.snippet,
        url:       r.url,
        tags:      r.tags,
        thumbnail: r.thumbnail
          ? `${baseUrl}/sharing/rest/content/items/${r.id}/info/${r.thumbnail}?token=${token}`
          : null,
        numViews: r.numViews,
      }))

      return { total: data.total, owner, items }
    } catch (err) {
      return reply.status(500).send({
        statusCode: 500,
        error: 'Search failed',
        message: err.message,
      })
    }
  })

  // GET /api/admin/arcgis/layers/inspect — fetch metadata for a single feature service
  fastify.get('/arcgis/layers/inspect', {
    preHandler: fastify.requireRole('admin'),
    schema: {
      querystring: {
        type: 'object',
        properties: {
          itemId: { type: 'string' },
          url:    { type: 'string' },
        },
      },
    },
  }, async (request, reply) => {
    const [config] = await sql`SELECT * FROM arcgis_config LIMIT 1`
    if (!config) {
      return reply.status(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Save ArcGIS configuration first.',
      })
    }

    try {
      const { clientId, clientSecret, baseUrl } = resolveCredentials(config)
      const token = await getArcGISToken(baseUrl, clientId, clientSecret)

      // Resolve service URL: itemId → item.url, or use raw URL
      let serviceUrl = request.query.url?.trim()
      let itemMeta   = null
      if (!serviceUrl && request.query.itemId) {
        const itemRes = await fetch(
          `${baseUrl}/sharing/rest/content/items/${request.query.itemId}?f=json&token=${token}`,
        )
        itemMeta = await itemRes.json()
        if (itemMeta.error) throw new Error(itemMeta.error.message)
        serviceUrl = itemMeta.url
      }
      if (!serviceUrl) {
        return reply.status(400).send({
          statusCode: 400,
          error: 'Bad Request',
          message: 'Provide itemId or a feature service URL',
        })
      }

      const normUrl = serviceUrl.replace(/\/+$/, '')
      const layerUrl = /\/\d+$/.test(normUrl) ? normUrl : `${normUrl}/0`

      const layerRes = await fetch(`${layerUrl}?f=json&token=${token}`)
      const layerMeta = await layerRes.json()
      if (layerMeta.error) throw new Error(layerMeta.error.message)

      const countRes = await fetch(
        `${layerUrl}/query?where=1=1&returnCountOnly=true&f=json&token=${token}`,
      )
      const countData = await countRes.json()

      // Pull a small sample so the user can see the data shape
      const sampleRes = await fetch(
        `${layerUrl}/query?where=1=1&outFields=*&resultRecordCount=3&f=json&token=${token}`,
      )
      const sampleData = await sampleRes.json()

      return {
        item: itemMeta && {
          itemId: itemMeta.id,
          title:  itemMeta.title,
          owner:  itemMeta.owner,
          tags:   itemMeta.tags,
        },
        name:           layerMeta.name,
        geometryType:   layerMeta.geometryType,
        objectIdField:  layerMeta.objectIdField,
        capabilities:   layerMeta.capabilities,
        featureCount:   countData?.count ?? null,
        extent:         layerMeta.extent,
        serviceUrl:     normUrl,
        layerUrl,
        fields: (layerMeta.fields || []).map((f) => ({
          name:   f.name,
          alias:  f.alias,
          type:   f.type,
          length: f.length,
        })),
        sample: (sampleData.features || []).slice(0, 3).map((f) => f.attributes),
      }
    } catch (err) {
      return reply.status(500).send({
        statusCode: 500,
        error: 'Inspect failed',
        message: err.message,
      })
    }
  })

  // POST /api/admin/arcgis/layers/attach — save layer ID to the matching slot + sync
  fastify.post('/arcgis/layers/attach', {
    preHandler: fastify.requireRole('admin'),
    schema: {
      body: {
        type: 'object',
        required: ['itemId', 'recordTypeId'],
        properties: {
          itemId:       { type: 'string' },
          recordTypeId: { type: 'integer' },
          syncNow:      { type: 'boolean', default: true },
        },
      },
    },
  }, async (request, reply) => {
    const { itemId, recordTypeId, syncNow = true } = request.body

    const [recordType] = await sql`
      SELECT type_name FROM record_type WHERE record_type_id = ${recordTypeId}
    `
    if (!recordType) {
      return reply.status(400).send({
        statusCode: 400, error: 'Bad Request', message: 'Unknown record type',
      })
    }

    const slotMap = {
      Parcel:         'parcel_layer_id',
      Business:       'business_layer_id',
      'Market Stall': 'market_stall_layer_id',
    }
    const column = slotMap[recordType.typeName]
    if (!column) {
      return reply.status(400).send({
        statusCode: 400, error: 'Bad Request',
        message: `No layer slot for record type "${recordType.typeName}"`,
      })
    }

    const [config] = await sql`SELECT config_id FROM arcgis_config LIMIT 1`
    if (!config) {
      return reply.status(400).send({
        statusCode: 400, error: 'Bad Request',
        message: 'Save ArcGIS configuration first.',
      })
    }

    await sql`
      UPDATE arcgis_config
      SET    ${sql(column)} = ${itemId}
      WHERE  config_id = ${config.configId}
    `

    await sql`
      INSERT INTO audit_log (user_id, action, table_name, record_id, new_values)
      VALUES (
        ${request.user.userId},
        'ATTACH_ARCGIS_LAYER',
        'arcgis_config',
        ${config.configId},
        ${JSON.stringify({ itemId, recordTypeId, slot: column })}
      )
    `

    let syncResult = null
    if (syncNow) {
      try {
        syncResult = await syncArcGIS(fastify.log)
      } catch (err) {
        fastify.log.error({ err }, 'Sync after attach failed')
      }
    }

    return {
      message: `Attached ${itemId} as ${recordType.typeName}.`,
      slot: column,
      sync: syncResult,
    }
  })
}
