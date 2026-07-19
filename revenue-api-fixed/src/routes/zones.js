// src/routes/zones.js
import { getDb } from '../db.js'

export default async function zoneRoutes(fastify) {
  const sql = getDb()

  // GET /api/zones — list all zones as tree
  fastify.get('/', {
    preHandler: fastify.authenticate,
  }, async () => {
    return sql`
      SELECT
        z.zone_id,
        z.zone_name,
        z.zone_code,
        z.zone_type,
        z.parent_zone_id,
        p.zone_name AS parent_zone_name,
        COUNT(tr.record_id)::int AS record_count
      FROM zone z
      LEFT JOIN zone p ON p.zone_id = z.parent_zone_id
      LEFT JOIN taxpayer_record tr ON tr.zone_id = z.zone_id
      GROUP BY z.zone_id, z.zone_name, z.zone_code, z.zone_type, z.parent_zone_id, p.zone_name
      ORDER BY z.zone_type, z.zone_name
    `
  })

  // POST /api/zones — create zone (admin only)
  fastify.post('/', {
    preHandler: fastify.requireRole('admin'),
    schema: {
      body: {
        type: 'object',
        required: ['zoneName', 'zoneCode', 'zoneType'],
        properties: {
          zoneName:     { type: 'string' },
          zoneCode:     { type: 'string' },
          zoneType:     { type: 'string', enum: ['county', 'subcounty', 'ward', 'village'] },
          parentZoneId: { type: 'integer' },
        },
      },
    },
  }, async (request, reply) => {
    const { zoneName, zoneCode, zoneType, parentZoneId } = request.body

    const [existing] = await sql`SELECT zone_id FROM zone WHERE zone_code = ${zoneCode}`
    if (existing) return reply.status(409).send({ statusCode: 409, error: 'Conflict', message: 'Zone code already exists' })

    const [zone] = await sql`
      INSERT INTO zone (zone_name, zone_code, zone_type, parent_zone_id)
      VALUES (${zoneName}, ${zoneCode.toUpperCase()}, ${zoneType}, ${parentZoneId ?? null})
      RETURNING zone_id
    `

    return reply.status(201).send({ zoneId: zone.zoneId, message: 'Zone created' })
  })
}
