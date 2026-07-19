// src/plugins/auth.js
import fp from 'fastify-plugin'

async function authPlugin(fastify) {
  // Decorate request with authenticate helper
  fastify.decorate('authenticate', async function (request, reply) {
    try {
      await request.jwtVerify()
    } catch (err) {
      reply.status(401).send({ statusCode: 401, error: 'Unauthorized', message: 'Invalid or expired token' })
    }
  })

  // Role guard factory
  fastify.decorate('requireRole', function (...allowedRoles) {
    return async function (request, reply) {
      await fastify.authenticate(request, reply)
      if (reply.sent) return // already replied with 401

      const { role } = request.user
      if (!allowedRoles.includes(role)) {
        return reply.status(403).send({
          statusCode: 403,
          error: 'Forbidden',
          message: `This action requires one of: ${allowedRoles.join(', ')}`,
        })
      }
    }
  })
}

export default fp(authPlugin, { name: 'auth-plugin' })
