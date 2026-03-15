/**
 * Script directo para descargar el vault de Obsidian LiveSync desde CouchDB
 * Conecta directamente a la BD y desencripta con octagonal-wheels
 */

import PouchDB from 'pouchdb';
import findPouchDBAdapter from 'pouchdb-adapter-http';
import { decrypt, decryptWithEphemeralSalt, HKDF_ENCRYPTED_PREFIX, HKDF_SALTED_ENCRYPTED_PREFIX } from './node_modules/octagonal-wheels/dist/encryption/hkdf.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

PouchDB.plugin(findPouchDBAdapter);

// Credenciales CouchDB (extraídas del setup_uri o `config.json`)
const LIMIT = process.argv.includes('--limit') ? parseInt(process.argv[process.argv.indexOf('--limit') + 1]) : null;
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

const OUTPUT_DIR = path.join(__dirname, '../../RCV_Obsidian_Vault');

console.log(`[INFO] Conectando a CouchDB: ${COUCHDB_URI}/${COUCHDB_DBNAME}`);
console.log(`[INFO] Output: ${OUTPUT_DIR}`);

const db = new PouchDB(`${COUCHDB_URI}/${COUCHDB_DBNAME}`, {
  auth: { username: COUCHDB_USER, password: COUCHDB_PASSWORD }
});

// Test conexión
try {
  const info = await db.info();
  console.log(`[INFO] Conectado OK. Documentos en BD: ${info.doc_count}`);
} catch (e) {
  console.error('[ERROR] No se pudo conectar a CouchDB:', e.message);
  process.exit(1);
}

// Obtener salt PBKDF2 desde la BD
let pbkdf2Salt = null;
try {
  const syncParams = await db.get('_local/obsidian_livesync_sync_parameters');
  if (syncParams?.pbkdf2salt) {
    pbkdf2Salt = new Uint8Array(Buffer.from(syncParams.pbkdf2salt, 'base64'));
    console.log(`[INFO] Salt PBKDF2 obtenida desde BD: ${syncParams.pbkdf2salt.substring(0, 10)}...`);
  }
} catch (e) {
  console.warn('[WARN] No se encontró _local/obsidian_livesync_sync_parameters, chunks %=  no podrán descifrarse');
}

// Descargar todos los documentos
console.log('[INFO] Descargando todos los documentos...');
const allDocsOpts = { include_docs: true };
if (LIMIT !== null) allDocsOpts.limit = LIMIT;
const result = await db.allDocs(allDocsOpts);
console.log(`[INFO] Documentos descargados: ${result.rows.length}`);

// Analizar tipos de documentos
const typeCounts = {};
for (const row of result.rows) {
  const type = row.doc?.type || 'unknown';
  typeCounts[type] = (typeCounts[type] || 0) + 1;
}
console.log('[INFO] Tipos de documentos:', typeCounts);

// Mostrar algunos IDs de ejemplo
const sampleIds = result.rows.slice(0, 10).map(r => r.id);
console.log('[INFO] IDs de ejemplo:', sampleIds);

// Separar docs de chunks (leafs) y archivos (metadata)
const chunkMap = new Map();
const fileDocs = [];

for (const row of result.rows) {
  const doc = row.doc;
  if (!doc) { continue; }
  
  if (doc.type === 'leaf') {
    chunkMap.set(doc._id, doc);
  } else if (doc.type === 'notes' || doc.children) {
    fileDocs.push(doc);
  }
}

console.log(`[INFO] Chunks (leafs): ${chunkMap.size}`);
console.log(`[INFO] Archivos (notes): ${fileDocs.length}`);

if (fileDocs.length === 0 && chunkMap.size === 0) {
  // Intentar con estructura diferente
  console.log('[INFO] Intentando con todos los docs como archivos directos...');
  for (const row of result.rows) {
    if (!row.id.startsWith('_')) {
      fileDocs.push(row.doc);
    }
  }
  console.log(`[INFO] Archivos candidatos: ${fileDocs.length}`);
  
  // Mostrar estructura del primero
  if (fileDocs.length > 0) {
    const sample = fileDocs[0];
    console.log('[DEBUG] Estructura primer doc:', JSON.stringify({
      _id: sample._id,
      type: sample.type,
      data: sample.data ? sample.data.slice(0, 50) + '...' : undefined,
      children: sample.children,
      keys: Object.keys(sample)
    }, null, 2));
  }
}

// Función para desencriptar datos
async function tryDecrypt(data, passphrase, pbkdf2Salt) {
  if (!data) return null;

  // %$ → encrypted with ephemeral salt embedded
  if (data.startsWith(HKDF_SALTED_ENCRYPTED_PREFIX)) {
    try {
      return await decryptWithEphemeralSalt(data, passphrase);
    } catch (e) {
      return null;
    }
  }

  // %=  → encrypted with static PBKDF2 salt (needs salt from DB)
  if (data.startsWith(HKDF_ENCRYPTED_PREFIX)) {
    if (!pbkdf2Salt) return null;
    try {
      return await decrypt(data, passphrase, pbkdf2Salt);
    } catch (e) {
      return null;
    }
  }

  return null;
}

// Desencriptar chunks
console.log('\n[INFO] Desencriptando chunks...');
let decryptedChunks = 0;
let failedChunks = 0;

for (const [id, chunkDoc] of chunkMap) {
  if (chunkDoc.data) {
    const decrypted = await tryDecrypt(chunkDoc.data, PASSPHRASE, pbkdf2Salt);
    if (decrypted !== null) {
      chunkMap.set(id, { ...chunkDoc, decryptedData: Buffer.from(decrypted, 'utf8') });
      decryptedChunks++;
    } else {
      failedChunks++;
      if (failedChunks <= 3) {
        console.log(`[WARN] No se pudo desencriptar chunk: ${id}, data prefix: ${chunkDoc.data.slice(0,20)}`);
      }
    }
  }
}

console.log(`[INFO] Chunks desencriptados: ${decryptedChunks}, fallidos: ${failedChunks}`);

// Reconstruir y escribir archivos
console.log('\n[INFO] Reconstruyendo archivos...');
let written = 0;
let skipped = 0;

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

for (const fileDoc of fileDocs) {
  const relativePath = fileDoc._id || fileDoc.path;
  if (!relativePath || relativePath.startsWith('_')) {
    skipped++;
    continue;
  }
  
  const fullPath = path.resolve(OUTPUT_DIR, relativePath);
  const dir = path.dirname(fullPath);
  
  // Seguridad: no escribir fuera de OUTPUT_DIR
  if (!fullPath.startsWith(path.resolve(OUTPUT_DIR))) {
    console.warn(`[WARN] Path inseguro ignorado: ${relativePath}`);
    skipped++;
    continue;
  }

  // Si está marcado como borrado en CouchDB, lo borramos de local si existe
  if (fileDoc.deleted) {
    if (fs.existsSync(fullPath)) {
      try {
        fs.unlinkSync(fullPath);
        console.log(`  [DELETE] ${relativePath} (eliminado en local)`);
      } catch (err) {
        console.error(`[ERROR] No se pudo borrar el archivo local ${relativePath}:`, err.message);
      }
    }
    continue;
  }
  
  try {
    // Intentar reconstruir desde chunks
    if (fileDoc.children && Array.isArray(fileDoc.children) && fileDoc.children.length > 0) {
      const buffers = fileDoc.children
        .map(id => chunkMap.get(id)?.decryptedData)
        .filter(b => b !== undefined);
      
      if (buffers.length > 0) {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(fullPath, Buffer.concat(buffers));
        written++;
        if (written <= 5 || written % 50 === 0) {
          console.log(`  [WRITE] ${relativePath} (${buffers.length} chunks)`);
        }
        continue;
      }
    }
    // Tratamiento para archivos vacíos tipo plain/notes
    if (fileDoc.size === 0 && (!fileDoc.children || fileDoc.children.length === 0) && !fileDoc.data) {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(fullPath, Buffer.from(''));
      written++;
      if (written <= 5 || written % 50 === 0) {
        console.log(`  [WRITE] ${relativePath} (empty file)`);
      }
      continue;
    }

    // Intentar con datos directos en el doc
    if (fileDoc.data) {
      const decrypted = await tryDecrypt(fileDoc.data, PASSPHRASE, pbkdf2Salt);
      if (decrypted !== null) {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(fullPath, Buffer.from(decrypted, 'utf8'));
        written++;
        if (written <= 5 || written % 50 === 0) {
          console.log(`  [WRITE] ${relativePath}`);
        }
        continue;
      }
    }
    
    skipped++;
  } catch (e) {
    console.error(`[ERROR] Fallo al escribir ${relativePath}:`, e.message);
    skipped++;
  }
}

console.log(`\n✅ COMPLETADO`);
console.log(`   Archivos escritos: ${written}`);
console.log(`   Archivos omitidos: ${skipped}`);
console.log(`   Destino: ${OUTPUT_DIR}`);

if (written > 0) {
  console.log('\n[INFO] Archivos escritos:');
  const walkDir = (dir, prefix = '') => {
    const entries = fs.readdirSync(dir);
    for (const entry of entries.slice(0, 20)) {
      const fullPath = path.join(dir, entry);
      const stat = fs.statSync(fullPath);
      console.log(`  ${prefix}${entry}${stat.isDirectory() ? '/' : ''}`);
      if (stat.isDirectory()) walkDir(fullPath, prefix + '  ');
    }
  };
  walkDir(OUTPUT_DIR);
}
