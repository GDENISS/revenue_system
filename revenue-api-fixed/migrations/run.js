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
    const files = readdirSync(__dirname)
      .filter((f) => f.endsWith('.sql'))
      .sort()

    for (const file of files) {
      const path = join(__dirname, file)
      const migrationSQL = readFileSync(path, 'utf8')
      try {
        await sql.unsafe(migrationSQL)
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
