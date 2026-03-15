/**
 * Script directo para subir archivos al vault de Obsidian LiveSync en CouchDB
 * Espejo de pull_vault_direct.mjs — sin capa de plugin.
 *
 * Uso:
 *   node push_vault_direct.mjs <directorio-local> [--dry-run] [--filter <prefijo>]
 *
 * Ejemplos:
 *   node push_vault_direct.mjs ./RCV_Obsidian_Vault_Test
 *   node push_vault_direct.mjs ./sky --filter sky/
 *   node push_vault_direct.mjs ./sky --dry-run
 */

import PouchDB from 'pouchdb';
import findPouchDBAdapter from 'pouchdb-adapter-http';
import { decryptWithEphemeralSalt, encryptBinary, HKDF_ENCRYPTED_PREFIX } from './node_modules/octagonal-wheels/dist/encryption/hkdf.js';
import xxhash from 'xxhash-wasm';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

PouchDB.plugin(findPouchDBAdapter);

// ── Configuración ────────────────────────────────────────────────────────────
const configPath = path.join(__dirname, 'config.json');
let config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

if (!config.couchdb_url && config.setup_uri) {
  console.log('[INFO] Extrayendo credenciales desde setup_uri...');
  let encryptedData = config.setup_uri;
  if(encryptedData.includes('settings=')) encryptedData = encryptedData.split('settings=')[1];
  encryptedData = decodeURIComponent(encryptedData);
  let decodeCount = 0;
  while (encryptedData.includes('%') && !encryptedData.startsWith('%$') && decodeCount < 5) {
    try { const next = decodeURIComponent(encryptedData); if (next === encryptedData) break; encryptedData = next; decodeCount++; } catch (e) { break; }
  }
  if (encryptedData.startsWith('%24')) encryptedData = '%' + decodeURIComponent(encryptedData);
  else if (encryptedData.startsWith('$')) encryptedData = '%' + encryptedData;
  const decrypted = await decryptWithEphemeralSalt(encryptedData, config.passphrase);
  const vaultSettings = JSON.parse(decrypted);

  config.couchdb_url = vaultSettings.couchDB_URI;
  config.couchdb_user = vaultSettings.couchDB_USER;
  config.couchdb_password = vaultSettings.couchDB_PASSWORD;
  config.couchdb_dbname = vaultSettings.couchDB_DBNAME;
  if (vaultSettings.pbkdf2_salts) config.pbkdf2_salts = vaultSettings.pbkdf2_salts;
  delete config.setup_uri;
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log('[INFO] Credenciales guardadas en config.json de manera permanente.');
} else if (!config.couchdb_url) {
  console.error('[ERROR] No hay credenciales limpias ni setup_uri en config.json');
  process.exit(1);
}

const COUCHDB_URI      = config.couchdb_url;
const COUCHDB_USER     = config.couchdb_user;
const COUCHDB_PASSWORD = config.couchdb_password;
const COUCHDB_DBNAME   = config.couchdb_dbname_override || config.couchdb_dbname;
const PASSPHRASE       = config.passphrase;
const CHUNK_SIZE       = 50 * 1024; // 50 KB — igual que Obsidian LiveSync

// ── Args ─────────────────────────────────────────────────────────────────────
const args        = process.argv.slice(2);
const SOURCE_DIR  = args[0] ? path.resolve(args[0]) : path.join(__dirname, '../../RCV_Obsidian_Vault');
const DRY_RUN     = args.includes('--dry-run');
const filterIdx   = args.indexOf('--filter');
const FILTER      = filterIdx !== -1 ? args[filterIdx + 1] : null;

console.log(`[INFO] Fuente      : ${SOURCE_DIR}`);
console.log(`[INFO] CouchDB     : ${COUCHDB_URI}/${COUCHDB_DBNAME}`);
console.log(`[INFO] Dry-run     : ${DRY_RUN}`);
if (FILTER) console.log(`[INFO] Filtro      : ${FILTER}`);

if (!fs.existsSync(SOURCE_DIR)) {
  console.error(`[ERROR] Directorio no encontrado: ${SOURCE_DIR}`);
  process.exit(1);
}

// ── Conexión CouchDB ─────────────────────────────────────────────────────────
const db = new PouchDB(`${COUCHDB_URI}/${COUCHDB_DBNAME}`, {
  auth: { username: COUCHDB_USER, password: COUCHDB_PASSWORD }
});

try {
  const info = await db.info();
  console.log(`[INFO] Conectado OK. Documentos en BD: ${info.doc_count}`);
} catch (e) {
  console.error('[ERROR] No se pudo conectar a CouchDB:', e.message);
  process.exit(1);
}

// ── Salt PBKDF2 desde la BD ──────────────────────────────────────────────────
let pbkdf2Salt = null;
try {
  const syncParams = await db.get('_local/obsidian_livesync_sync_parameters');
  if (syncParams?.pbkdf2salt) {
    pbkdf2Salt = new Uint8Array(Buffer.from(syncParams.pbkdf2salt, 'base64'));
    console.log(`[INFO] Salt PBKDF2 obtenida desde BD: ${syncParams.pbkdf2salt.substring(0, 10)}...`);
  }
} catch (e) {
  console.warn('[WARN] No se encontró _local/obsidian_livesync_sync_parameters');
  console.warn('       Los chunks se cifrarán con salt ephemeral (%$). Obsidian puede no leerlos.');
}

// ── Hasher xxhash ────────────────────────────────────────────────────────────
const hasher = await xxhash();

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Cifra un chunk y lo sube a CouchDB. Devuelve el chunkId. */
async function putChunk(chunkBuf) {
  const chunkId = `h:+${hasher.h64(chunkBuf.toString('binary')).toString(36)}`;

  if (DRY_RUN) return chunkId;

  // Comprobar si ya existe para obtener el _rev y sobrescribir
  let rev;
  try {
    const existing = await db.get(chunkId);
    rev = existing._rev;
  } catch (e) {
    if (e.status !== 404) throw e;
  }

  const encryptedDataBinary = await encryptBinary(
    chunkBuf,
    PASSPHRASE,
    pbkdf2Salt
  );
  
  // Format to base64, then prefix with %=
  const inBase64 = Buffer.from(encryptedDataBinary).toString('base64');
  const finalEncryptedData = `${HKDF_ENCRYPTED_PREFIX}${inBase64}`;

  await db.put({
    _id:  chunkId,
    ...(rev ? { _rev: rev } : {}),
    data: finalEncryptedData,
    type: 'leaf',
    e_:   true
  });

  return chunkId;
}

/** Sube un archivo completo (chunked + encrypted) a CouchDB. */
async function pushFile(fullPath, relativePath) {
  const content   = fs.readFileSync(fullPath);
  const stats     = fs.statSync(fullPath);
  const docId     = relativePath.replace(/\\/g, '/').toLowerCase();

  // Chunk + cifrar
  const children = [];
  for (let i = 0; i < content.length; i += CHUNK_SIZE) {
    const chunkBuf = content.slice(i, i + CHUNK_SIZE);
    const chunkId  = await putChunk(chunkBuf);
    children.push(chunkId);
  }
  // Archivo vacío → un leaf vacío igualmente
  if (children.length === 0) {
    const chunkId = await putChunk(Buffer.alloc(0));
    children.push(chunkId);
  }

  if (DRY_RUN) {
    console.log(`  [DRY] ${relativePath} → ${children.length} chunk(s)`);
    return { chunks: children.length, bytes: content.length };
  }

  // Obtener _rev si existe (para hacer update)
  let rev;
  try {
    const existing = await db.get(docId);
    // Si el mtime es idéntico, saltamos para evitar repeticiones innecesarias
    if (existing.mtime === Math.floor(stats.mtimeMs) && existing.size === content.length) {
      return { chunks: children.length, bytes: content.length, skipped: true };
    }
    rev = existing._rev;
  } catch (e) {
    if (e.status !== 404) throw e;
  }

  const doc = {
    _id:      docId,
    ...(rev ? { _rev: rev } : {}),
    path:     relativePath.replace(/\\/g, '/'),
    children,
    ctime:    Math.floor(stats.birthtimeMs || stats.ctimeMs),
    mtime:    Math.floor(stats.mtimeMs),
    size:     content.length,
    type:     'plain',
    eden:     {}
  };

  await db.put(doc);
  return { chunks: children.length, bytes: content.length, skipped: false };
}

/** Recorre un directorio recursivamente y devuelve rutas de archivos. */
function walkDir(dir, base) {
  const results = [];
  for (const entry of fs.readdirSync(dir)) {
    if (entry.startsWith('.')) continue;
    const full = path.join(dir, entry);
    const rel  = path.relative(base, full).replace(/\\/g, '/');
    if (FILTER && !rel.startsWith(FILTER)) {
      if (fs.statSync(full).isDirectory()) {
        results.push(...walkDir(full, base));
      }
      continue;
    }
    if (fs.statSync(full).isDirectory()) {
      results.push(...walkDir(full, base));
    } else {
      results.push({ full, rel });
    }
  }
  return results;
}

// ── Main ─────────────────────────────────────────────────────────────────────
const files = walkDir(SOURCE_DIR, SOURCE_DIR);
console.log(`\n[INFO] Archivos encontrados: ${files.length}`);

let pushed   = 0;
let skipped  = 0;
let failed   = 0;
let totalChunks = 0;

for (const { full, rel } of files) {
  try {
    const result = await pushFile(full, rel);
    totalChunks += result.chunks;
    if (result.skipped) {
      skipped++;
    } else {
      pushed++;
      if (!DRY_RUN && (pushed <= 10 || pushed % 50 === 0)) {
        console.log(`  [PUSH] ${rel} (${result.chunks} chunks, ${result.bytes} bytes)`);
      }
    }
  } catch (e) {
    failed++;
    console.error(`  [ERROR] ${rel}: ${e.message}`);
  }
}

console.log(`\n${DRY_RUN ? '🔍 DRY-RUN' : '✅'} COMPLETADO`);
console.log(`   Subidos  : ${pushed}`);
console.log(`   Sin cambios: ${skipped}`);
console.log(`   Fallidos : ${failed}`);
console.log(`   Chunks totales: ${totalChunks}`);
console.log(`   Destino  : ${COUCHDB_URI}/${COUCHDB_DBNAME}`);
