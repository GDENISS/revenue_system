// src/db.js
import postgres from 'postgres'

let sql

export function getDb() {
  if (!sql) {
    sql = postgres(process.env.DATABASE_URL, {
      max: 20,
      idle_timeout: 30,
      connect_timeout: 10,
      transform: {
        // Return JS camelCase from snake_case column names
        column: postgres.toCamel,
      },
      onnotice: () => {}, // suppress NOTICE logs from migrations
    })
  }
  return sql
}

export async function closeDb() {
  if (sql) {
    await sql.end()
    sql = null
  }
}
