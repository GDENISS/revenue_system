// migrations/run.js
import 'dotenv/config'
import { readFileSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import postgres from 'postgres'

const __dirname = dirname(fileURLToPath(import.meta.url))

async function migrate() {
  const sql = postgres(process.env.DATABASE_URL, { max: 1 })

  try {
    console.log('🚀 Running migrations...')

    // Each file runs exactly once. Without this, every container restart
    // re-ran the whole chain — schema files tolerate that, but data files
    // (dummy seed) mutate live rows and eventually collide with app-created
    // data (e.g. duplicate notice numbers).
    await sql`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `
    const applied = new Set(
      (await sql`SELECT filename FROM schema_migrations`).map((r) => r.filename),
    )

    const files = readdirSync(__dirname)
      .filter((f) => f.endsWith('.sql'))
      .sort()

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`⏭  ${file} already applied`)
        continue
      }
      const path = join(__dirname, file)
      const migrationSQL = readFileSync(path, 'utf8')
      try {
        await sql.unsafe(migrationSQL)
        await sql`INSERT INTO schema_migrations (filename) VALUES (${file})`
        console.log(`✅ ${file} applied`)
      } catch (err) {
        console.error(`❌ ${file} failed:`, err.message)
        throw err
      }
    }

    console.log('✅ All migrations applied')
  } catch {
    process.exit(1)
  } finally {
    await sql.end()
  }
}

migrate()
