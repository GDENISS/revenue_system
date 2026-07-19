// src/app.js
import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import jwt from '@fastify/jwt'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'

import authPlugin from './plugins/auth.js'
import authRoutes from './routes/auth.js'
import recordRoutes from './routes/records.js'
import feeRoutes from './routes/fees.js'
import noticeRoutes from './routes/notices.js'
import paymentRoutes from './routes/payments.js'
import dashboardRoutes from './routes/dashboard.js'
import adminRoutes from './routes/admin.js'
import zoneRoutes from './routes/zones.js'
import taskRoutes from './routes/tasks.js'

export async function buildApp(opts = {}) {
  const app = Fastify({
    logger: opts.logger ?? {
      level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
      transport: process.env.NODE_ENV !== 'production'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
    },
    ...opts,
  })

  // ── Raw body parser ─────────────────────────────────────────────────────
  // Paystack signs each webhook payload with HMAC-SHA512 over the exact bytes
  // it sent. We need the unmodified body string to verify, so override the
  // default JSON parser to stash the raw text on req.rawBody before parsing.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (req, body, done) => {
      req.rawBody = body
      try {
        done(null, body ? JSON.parse(body) : {})
      } catch (err) {
        err.statusCode = 400
        done(err)
      }
    },
  )

  // ── Security ────────────────────────────────────────────────────────────
  await app.register(helmet, { contentSecurityPolicy: false })
  await app.register(cors, {
    origin: process.env.ALLOWED_ORIGINS
      ? process.env.ALLOWED_ORIGINS.split(',')
      : true,
    credentials: true,
  })
  await app.register(rateLimit, {
    // Per-user limit. The previous global 200/min PER IP meant a county
    // office behind one NAT shared a single bucket — 30 staff on a busy
    // morning collectively tripped it. Keying by the JWT subject gives each
    // signed-in user their own bucket; anonymous requests (login attempts)
    // still share the IP bucket, which is what you want against brute force.
    max: 300,
    timeWindow: '1 minute',
    keyGenerator: (request) => {
      const auth = request.headers.authorization
      if (auth?.startsWith('Bearer ')) {
        try {
          // Decode (not verify — verification happens in the auth handler).
          // We only need a stable per-user key for bucketing.
          const payload = JSON.parse(
            Buffer.from(auth.slice(7).split('.')[1], 'base64url').toString(),
          )
          if (payload?.userId) return `user:${payload.userId}`
        } catch {
          /* malformed token → fall through to IP */
        }
      }
      return request.ip
    },
    allowList: (request) => request.url === '/health',
    errorResponseBuilder: () => ({
      statusCode: 429,
      error: 'Too Many Requests',
      message: 'Rate limit exceeded. Please slow down.',
    }),
  })

  // ── Auth ────────────────────────────────────────────────────────────────
  await app.register(jwt, {
    secret: process.env.JWT_SECRET,
    sign: { expiresIn: process.env.JWT_EXPIRES_IN || '8h' },
  })
  await app.register(authPlugin)

  // ── Swagger (API Docs) ──────────────────────────────────────────────────
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Revenue Management API',
        description: 'Local Government Revenue Management System',
        version: '1.0.0',
      },
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        },
      },
      security: [{ bearerAuth: [] }],
    },
  })
  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: { docExpansion: 'list', deepLinking: false },
  })

  // ── Health check ────────────────────────────────────────────────────────
  app.get('/health', { config: { public: true } }, async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  }))

  // ── Routes ──────────────────────────────────────────────────────────────
  await app.register(authRoutes,      { prefix: '/api/auth' })
  await app.register(recordRoutes,    { prefix: '/api/records' })
  await app.register(feeRoutes,       { prefix: '/api/fees' })
  await app.register(noticeRoutes,    { prefix: '/api/notices' })
  await app.register(paymentRoutes,   { prefix: '/api/payments' })
  await app.register(dashboardRoutes, { prefix: '/api/dashboard' })
  await app.register(adminRoutes,     { prefix: '/api/admin' })
  await app.register(zoneRoutes,      { prefix: '/api/zones' })
  await app.register(taskRoutes,      { prefix: '/api/tasks' })

  // ── Global error handler ────────────────────────────────────────────────
  app.setErrorHandler((error, request, reply) => {
    const statusCode = error.statusCode || 500
    app.log.error({ err: error, url: request.url }, 'Request error')

    if (statusCode >= 500) {
      return reply.status(500).send({
        statusCode: 500,
        error: 'Internal Server Error',
        message: process.env.NODE_ENV === 'production'
          ? 'An unexpected error occurred'
          : error.message,
      })
    }

    return reply.status(statusCode).send({
      statusCode,
      error: error.name || 'Error',
      message: error.message,
    })
  })

  return app
}
