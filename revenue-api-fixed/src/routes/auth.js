// src/routes/auth.js
import { getDb } from "../db.js";

const DEFAULT_PORTAL = process.env.ARCGIS_BASE_URL || "https://www.arcgis.com";
const ADMIN_USERNAMES = (process.env.ARCGIS_ADMIN_USERNAMES || "")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

async function fetchArcgisSelf(portalUrl, token) {
  const base = portalUrl.replace(/\/+$/, "");
  const url = `${base}/sharing/rest/community/self?f=json&token=${encodeURIComponent(token)}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`ArcGIS portal returned ${res.status}`);
  }
  const data = await res.json();
  if (data.error) {
    throw new Error(data.error.message || "ArcGIS token invalid");
  }
  if (!data.username) {
    throw new Error("ArcGIS profile is missing username");
  }
  return data;
}

export default async function authRoutes(fastify) {
  const sql = getDb();

  // POST /api/auth/login
  fastify.post(
    "/login",
    {
      config: { public: true },
      schema: {
        body: {
          type: "object",
          required: ["email", "password"],
          properties: {
            email: { type: "string", format: "email" },
            password: { type: "string", minLength: 1 },
          },
        },
        response: {
          200: {
            type: "object",
            properties: {
              token: { type: "string" },
              user: {
                type: "object",
                properties: {
                  userId: { type: "number" },
                  name: { type: "string" },
                  email: { type: "string" },
                  role: { type: "string" },
                  zoneId: { type: ["number", "null"] },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { email, password } = request.body;

      const [user] = await sql`
      SELECT
        u.user_id,
        u.name,
        u.email,
        u.password_hash,
        u.is_active,
        u.zone_id,
        r.role_name AS role
      FROM users u
      JOIN role r USING (role_id)
      WHERE u.email = ${email.toLowerCase()}
   `;

      if (!user) {
        return reply.status(401).send({
          statusCode: 401,
          error: "Unauthorized",
          message: "Invalid credentials",
        });
      }

      if (!user.isActive) {
        return reply.status(403).send({
          statusCode: 403,
          error: "Forbidden",
          message: "Account is disabled",
        });
      }

      // Verify password using pgcrypto
      const [{ valid }] = await sql`
      SELECT (password_hash = crypt(${password}, password_hash)) AS valid
      FROM users WHERE user_id = ${user.userId}
    `;

      if (!valid) {
        return reply.status(401).send({
          statusCode: 401,
          error: "Unauthorized",
          message: "Invalid credentials",
        });
      }

      const token = fastify.jwt.sign({
        userId: user.userId,
        email: user.email,
        role: user.role,
        zoneId: user.zoneId ?? null,
      });

      await sql`UPDATE users SET last_login_at = NOW() WHERE user_id = ${user.userId}`;

      await sql`
        INSERT INTO audit_log (user_id, action, table_name, record_id)
        VALUES (${user.userId}, 'LOGIN', 'users', ${user.userId})
      `;

      return {
        token,
        user: {
          userId: user.userId,
          name: user.name,
          email: user.email,
          role: user.role,
          zoneId: user.zoneId ?? null,
        },
      };
    },
  );

  // GET /api/auth/me
  fastify.get(
    "/me",
    {
      preHandler: fastify.authenticate,
    },
    async (request) => {
      const sql = getDb();
      const [user] = await sql`
      SELECT
        u.user_id,
        u.name,
        u.email,
        r.role_name AS role,
        u.zone_id,
        z.zone_name,
        u.last_login_at
      FROM users u
      JOIN role r USING (role_id)
      LEFT JOIN zone z USING (zone_id)
      WHERE u.user_id = ${request.user.userId}
    `;
      return user;
    },
  );

  // POST /api/auth/change-password
  fastify.post(
    "/change-password",
    {
      preHandler: fastify.authenticate,
      schema: {
        body: {
          type: "object",
          required: ["currentPassword", "newPassword"],
          properties: {
            currentPassword: { type: "string" },
            newPassword: { type: "string", minLength: 8 },
          },
        },
      },
    },
    async (request, reply) => {
      const { currentPassword, newPassword } = request.body;
      const { userId } = request.user;

      const [{ valid }] = await sql`
      SELECT (password_hash = crypt(${currentPassword}, password_hash)) AS valid
      FROM users WHERE user_id = ${userId}
    `;

      if (!valid) {
        return reply.status(400).send({
          statusCode: 400,
          error: "Bad Request",
          message: "Current password is incorrect",
        });
      }

      await sql`
      UPDATE users
      SET password_hash = crypt(${newPassword}, gen_salt('bf'))
      WHERE user_id = ${userId}
    `;

      return { message: "Password changed successfully" };
    },
  );

  // POST /api/auth/arcgis-bridge — exchange a portal token for a backend JWT.
  // Auto-provisions a local user row on first sign-in.
  fastify.post(
    "/arcgis-bridge",
    {
      config: { public: true },
      schema: {
        body: {
          type: "object",
          required: ["token"],
          properties: {
            token: { type: "string", minLength: 8 },
            portalUrl: { type: "string" },
          },
        },
      },
    },
    async (request, reply) => {
      const { token, portalUrl } = request.body;
      const portal = portalUrl || DEFAULT_PORTAL;

      let arcgisProfile;
      try {
        arcgisProfile = await fetchArcgisSelf(portal, token);
      } catch (err) {
        return reply.status(401).send({
          statusCode: 401,
          error: "Unauthorized",
          message:
            err && err.message
              ? `ArcGIS sign-in failed: ${err.message}`
              : "ArcGIS sign-in failed",
        });
      }

      const arcgisUsername = String(arcgisProfile.username);
      const fullName = (arcgisProfile.fullName || arcgisUsername).trim();
      const arcgisEmail =
        typeof arcgisProfile.email === "string" && arcgisProfile.email
          ? arcgisProfile.email.toLowerCase()
          : null;

      // 1. Try to match an existing row by arcgis_username, then by email.
      let [user] = await sql`
        SELECT
          u.user_id,
          u.name,
          u.email,
          u.is_active,
          u.zone_id,
          u.auth_provider,
          u.arcgis_username,
          r.role_name AS role
        FROM users u
        JOIN role r USING (role_id)
        WHERE u.arcgis_username = ${arcgisUsername}
        LIMIT 1
      `;

      if (!user && arcgisEmail) {
        [user] = await sql`
          SELECT
            u.user_id,
            u.name,
            u.email,
            u.is_active,
            u.zone_id,
            u.auth_provider,
            u.arcgis_username,
            r.role_name AS role
          FROM users u
          JOIN role r USING (role_id)
          WHERE u.email = ${arcgisEmail}
          LIMIT 1
        `;
      }

      // 2. Backfill arcgis_username if we matched by email.
      if (user && !user.arcgisUsername) {
        await sql`
          UPDATE users
          SET arcgis_username = ${arcgisUsername},
              auth_provider = 'arcgis'
          WHERE user_id = ${user.userId}
        `;
      }

      // 3. Auto-provision on first sign-in.
      if (!user) {
        const isBootstrapAdmin = ADMIN_USERNAMES.includes(arcgisUsername.toLowerCase());

        // First user ever (count==0) becomes admin too — bootstrap path.
        const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM users`;
        const wantedRole = isBootstrapAdmin || count === 0 ? "admin" : "officer";
        const [{ roleId }] = await sql`SELECT role_id FROM role WHERE role_name = ${wantedRole}`;

        const insertEmail = arcgisEmail || `${arcgisUsername}@arcgis.local`;
        const [created] = await sql`
          INSERT INTO users (
            name, email, password_hash, role_id,
            arcgis_username, auth_provider, is_active
          )
          VALUES (
            ${fullName}, ${insertEmail}, NULL, ${roleId},
            ${arcgisUsername}, 'arcgis', TRUE
          )
          RETURNING user_id, name, email, is_active, zone_id, arcgis_username
        `;

        await sql`
          INSERT INTO audit_log (user_id, action, table_name, record_id)
          VALUES (${created.userId}, 'PROVISION_ARCGIS_USER', 'users', ${created.userId})
        `;

        user = {
          userId: created.userId,
          name: created.name,
          email: created.email,
          isActive: created.isActive,
          zoneId: created.zoneId,
          authProvider: "arcgis",
          arcgisUsername: created.arcgisUsername,
          role: wantedRole,
        };
      }

      if (!user.isActive) {
        return reply.status(403).send({
          statusCode: 403,
          error: "Forbidden",
          message: "Account is disabled — contact your administrator.",
        });
      }

      const jwtToken = fastify.jwt.sign({
        userId: user.userId,
        email: user.email,
        role: user.role,
        zoneId: user.zoneId ?? null,
      });

      await sql`UPDATE users SET last_login_at = NOW() WHERE user_id = ${user.userId}`;
      await sql`
        INSERT INTO audit_log (user_id, action, table_name, record_id)
        VALUES (${user.userId}, 'LOGIN_ARCGIS', 'users', ${user.userId})
      `;

      return {
        token: jwtToken,
        user: {
          userId: user.userId,
          name: user.name,
          email: user.email,
          role: user.role,
          zoneId: user.zoneId ?? null,
          arcgisUsername: user.arcgisUsername ?? arcgisUsername,
        },
      };
    },
  );
}
