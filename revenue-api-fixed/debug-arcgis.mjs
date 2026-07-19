import 'dotenv/config'
import { getDb, closeDb } from './src/db.js'
import { resolveCredentials, getArcGISToken } from './src/services/arcgis-sync.js'

const sql = getDb()
const [config] = await sql`SELECT * FROM arcgis_config LIMIT 1`
await closeDb()

const { clientId, clientSecret, baseUrl } = resolveCredentials(config)
console.log('baseUrl:', baseUrl)
console.log('parcelLayerId:', config.parcelLayerId)
console.log('lastSyncAt:', config.lastSyncAt)

const token = await getArcGISToken(baseUrl, clientId, clientSecret)
console.log('token: OK (' + token.slice(0, 12) + '...)')

// Step 1: resolve item -> service URL
const itemRes = await fetch(`${baseUrl}/sharing/rest/content/items/${config.parcelLayerId}?f=json&token=${token}`)
const item = await itemRes.json()
console.log('\n--- ITEM ---')
console.log('title:', item.title, '| type:', item.type)
console.log('url:', item.url)
if (item.error) { console.log('ITEM ERROR:', JSON.stringify(item.error)); process.exit(1) }

const serviceUrl = String(item.url).replace(/\/+$/, '')
const layerUrl = /\/\d+$/.test(serviceUrl) ? serviceUrl : `${serviceUrl}/0`
console.log('layerUrl:', layerUrl)

// Step 2: layer metadata
console.log('\n--- LAYER METADATA ---')
const metaRes = await fetch(`${layerUrl}?f=json&token=${token}`)
console.log('HTTP', metaRes.status, metaRes.headers.get('content-type'))
const metaText = await metaRes.text()
let meta
try { meta = JSON.parse(metaText) } catch { console.log('NON-JSON response:', metaText.slice(0, 300)); process.exit(1) }
if (meta.error) { console.log('META ERROR:', JSON.stringify(meta.error)) }
else {
  console.log('name:', meta.name, '| geometryType:', meta.geometryType, '| oidField:', meta.objectIdField)
  console.log('fields:', (meta.fields ?? []).map(f => f.name).join(', '))
}

// Step 3: minimal query — where=1=1, outFields=*
console.log('\n--- QUERY (1=1, outFields=*) ---')
const q1 = new URL(`${layerUrl}/query`)
q1.searchParams.set('where', '1=1')
q1.searchParams.set('outFields', '*')
q1.searchParams.set('returnGeometry', 'false')
q1.searchParams.set('resultRecordCount', '3')
q1.searchParams.set('f', 'json')
q1.searchParams.set('token', token)
const q1Res = await fetch(q1)
console.log('HTTP', q1Res.status, q1Res.headers.get('content-type'))
const q1Text = await q1Res.text()
try {
  const q1Data = JSON.parse(q1Text)
  if (q1Data.error) console.log('QUERY ERROR:', JSON.stringify(q1Data.error))
  else console.log('features returned:', q1Data.features?.length, '| sample attrs:', JSON.stringify(q1Data.features?.[0]?.attributes ?? {}).slice(0, 200))
} catch { console.log('NON-JSON response:', q1Text.slice(0, 300)) }

// Step 4: the sync's exact query with EditDate WHERE
if (config.lastSyncAt) {
  console.log('\n--- QUERY (EditDate incremental — what sync sends) ---')
  const where = `EditDate > TIMESTAMP '${new Date(config.lastSyncAt).toISOString().replace('T', ' ').split('.')[0]}'`
  console.log('where:', where)
  const q2 = new URL(`${layerUrl}/query`)
  q2.searchParams.set('where', where)
  q2.searchParams.set('outFields', 'OBJECTID,taxpayer_name,zone_id')
  q2.searchParams.set('returnGeometry', 'false')
  q2.searchParams.set('f', 'json')
  q2.searchParams.set('token', token)
  const q2Res = await fetch(q2)
  console.log('HTTP', q2Res.status, q2Res.headers.get('content-type'))
  const q2Text = await q2Res.text()
  try {
    const q2Data = JSON.parse(q2Text)
    if (q2Data.error) console.log('QUERY ERROR:', JSON.stringify(q2Data.error))
    else console.log('features returned:', q2Data.features?.length)
  } catch { console.log('NON-JSON (HTML error page):', q2Text.slice(0, 150).replace(/\s+/g, ' ')) }
}
