import PouchDB from 'pouchdb';
import findPouchDBAdapter from 'pouchdb-adapter-http';
import fs from 'fs';
import path from 'path';
import { encrypt as encryptHKDF, decrypt as decryptHKDF, decryptWithEphemeralSalt } from 'octagonal-wheels/encryption/hkdf';
import xxhash from 'xxhash-wasm';

PouchDB.plugin(findPouchDBAdapter);

interface VaultSettings {
  couchDB_URI: string;
  couchDB_DBNAME: string;
  couchDB_USER: string;
  couchDB_PASSWORD: string;
  pbkdf2_salts?: string; // Base64-encoded salt
}

interface SyncAuditLog {
  timestamp: number;
  action: 'sync_file' | 'pull_vault' | 'error';
  path?: string;
  status: 'success' | 'error';
  message: string;
  scope?: string;
}

/**
 * Logger estructurado para auditoría
 */
class StructuredLogger {
  private auditLog: SyncAuditLog[] = [];
  private maxLogSize = 1000;

  log(action: SyncAuditLog) {
    const timestamp = new Date().toISOString();
    const logEntry = { ...action, timestamp: Date.now() };
    this.auditLog.push(logEntry);
    
    // Mantener el log acotado
    if (this.auditLog.length > this.maxLogSize) {
      this.auditLog.shift();
    }

    const prefix = `[${timestamp}] [${action.action}]`;
    const scopeInfo = action.scope ? ` [${action.scope}]` : '';
    const pathInfo = action.path ? ` ${action.path}` : '';
    
    if (action.status === 'error') {
      console.error(`${prefix}${scopeInfo} ERROR:${pathInfo} ${action.message}`);
    } else {
      console.log(`${prefix}${scopeInfo} OK:${pathInfo} ${action.message}`);
    }
  }

  getAuditLog(): SyncAuditLog[] {
    return [...this.auditLog];
  }
}

/**
 * Control de acceso por scope (000-099 = Raúl, 100+ = Sky, etc.)
 */
class ScopeValidator {
  private allowedScopes: Map<string, string[]> = new Map();

  constructor(agentId: string = 'sky') {
    // Definir scopes permitidos por agente
    this.allowedScopes.set('raul', ['000', '001', '002', '003', '004', '005']);
    this.allowedScopes.set('sky', ['100', '101', '102', '103', '104']);
    this.allowedScopes.set('shared', ['200', '201']);
  }

  /**
   * Validar si una ruta está permitida para este agente
   */
  isAllowed(filePath: string, agentId: string = 'sky'): { allowed: boolean; scope?: string; reason?: string } {
    const normalized = filePath.toLowerCase().replace(/\\/g, '/');
    const scopes = this.allowedScopes.get(agentId);

    if (!scopes) {
      return { allowed: false, reason: `Agente desconocido: ${agentId}` };
    }

    // Extraer prefijo (000, 100, etc.)
    const parts = normalized.split('/');
    const folderPrefix = parts[0];

    // Permitir acceso a carpetas asignadas
    for (const scope of scopes) {
      if (folderPrefix.startsWith(scope)) {
        return { allowed: true, scope: folderPrefix };
      }
    }

    return {
      allowed: false,
      reason: `Acceso denegado: ${agentId} no tiene permiso para ${normalized}. Scopes permitidos: ${scopes.join(', ')}`
    };
  }
}

export default class ObsidianLiveSyncPlugin {
  private db: any;
  private config: any;
  private vaultSettings: any;
  private hasher: any;
  private logger: StructuredLogger;
  private scopeValidator: ScopeValidator;
  private pbkdf2Salt: Uint8Array | null = null;

  constructor(config: any) {
    this.config = config;
    this.logger = new StructuredLogger();
    this.scopeValidator = new ScopeValidator(config.agentId || 'sky');
  }

  async initialize() {
    try {
      this.hasher = await xxhash();
      
      // Extraer settings del URI
      let encryptedData = this.config.setup_uri;
      if (encryptedData.includes('settings=')) {
        encryptedData = encryptedData.split('settings=')[1];
      }
      encryptedData = decodeURIComponent(encryptedData);

      const decrypted = await decryptWithEphemeralSalt(encryptedData, this.config.passphrase);
      this.vaultSettings = JSON.parse(decrypted) as VaultSettings;
      
      // **CRÍTICO**: Extraer salt dinámicamente (NO hardcodeado)
      if (!this.vaultSettings.pbkdf2_salts) {
        throw new Error('Salt no encontrado en settings. Verifica el setup_uri.');
      }
      this.pbkdf2Salt = Buffer.from(this.vaultSettings.pbkdf2_salts, 'base64');
      
      const remoteUrl = `${this.vaultSettings.couchDB_URI}/${this.vaultSettings.couchDB_DBNAME}`;
      this.db = new PouchDB(remoteUrl, {
        auth: { 
          username: this.vaultSettings.couchDB_USER, 
          password: this.vaultSettings.couchDB_PASSWORD 
        }
      });

      this.logger.log({
        action: 'sync_file',
        status: 'success',
        message: `Plugin inicializado. Conectado a CouchDB.`,
        scope: 'init'
      });
    } catch (e: any) {
      this.logger.log({
        action: 'error',
        status: 'error',
        message: `Inicialización fallida: ${e.message}. Verifica passphrase y setup_uri.`,
        scope: 'init'
      });
      throw e;
    }
  }

  /**
   * Tool: Sync a file to CouchDB con validación de scope y manejo de errores robusto
   */
  async obsidian_sync_file({ filePath }: { filePath: string }) {
    const agentId = this.config.agentId || 'sky';
    
    // **VALIDACIÓN P0**: Verificar ACL
    const scopeCheck = this.scopeValidator.isAllowed(filePath, agentId);
    if (!scopeCheck.allowed) {
      this.logger.log({
        action: 'sync_file',
        path: filePath,
        scope: agentId,
        status: 'error',
        message: scopeCheck.reason || 'Acceso denegado'
      });
      throw new Error(`[ACL VIOLATION] ${scopeCheck.reason}`);
    }

    try {
      const fullPath = path.resolve(process.cwd(), filePath);
      if (!fs.existsSync(fullPath)) {
        throw new Error(`Archivo no encontrado: ${filePath}`);
      }

      const content = fs.readFileSync(fullPath);
      if (!this.pbkdf2Salt) {
        throw new Error('Salt no inicializado. Ejecuta initialize() primero.');
      }

      const CHUNK_SIZE = 50 * 1024;
      const children: string[] = [];
      let chunkCount = 0;

      // Chunking y encripción
      for (let i = 0; i < content.length; i += CHUNK_SIZE) {
        const chunkData = content.slice(i, i + CHUNK_SIZE);
        const chunkHash = this.hasher.h64(chunkData.toString('binary'));
        const chunkId = `h:+${chunkHash}`;

        const encryptedData = await encryptHKDF(
          chunkData.toString('base64'),
          this.config.passphrase,
          this.pbkdf2Salt
        );

        try {
          await this.db.put({
            _id: chunkId,
            data: encryptedData,
            type: 'leaf',
            e_: true
          });
          chunkCount++;
        } catch (err: any) {
          if (err.status !== 409) throw err; // 409 = conflict (ya existe)
        }
        children.push(chunkId);
      }

      // Crear/actualizar documento
      const docId = filePath.toLowerCase().replace(/\\/g, '/');
      let existingDoc: any = {};
      try {
        existingDoc = await this.db.get(docId);
      } catch (err: any) {
        if (err.status !== 404) throw err;
      }

      const newDoc = {
        ...existingDoc,
        _id: docId,
        path: filePath,
        children: children,
        ctime: existingDoc.ctime || Date.now(),
        mtime: Date.now(),
        size: content.length,
        type: 'plain',
        eden: {}
      };

      await this.db.put(newDoc);

      this.logger.log({
        action: 'sync_file',
        path: filePath,
        scope: scopeCheck.scope,
        status: 'success',
        message: `Sincronizado (${chunkCount} chunks, ${content.length} bytes)`
      });

      return { 
        success: true, 
        message: `Archivo ${filePath} sincronizado con Obsidian.`,
        chunks: chunkCount,
        bytes: content.length
      };
    } catch (err: any) {
      this.logger.log({
        action: 'sync_file',
        path: filePath,
        scope: agentId,
        status: 'error',
        message: `Fallo: ${err.message}`
      });
      throw err;
    }
  }

  /**
   * Tool: Descargar vault completo desde CouchDB
   * Respeta scope: cada agente solo puede escribir en su carpeta
   */
  async obsidian_pull_vault() {
    const agentId = this.config.agentId || 'sky';

    if (!this.pbkdf2Salt) {
      throw new Error('Salt no inicializado. Ejecuta initialize() primero.');
    }

    try {
      this.logger.log({
        action: 'pull_vault',
        status: 'success',
        message: 'Iniciando descarga desde CouchDB...',
        scope: agentId
      });

      const result = await this.db.allDocs({ include_docs: true });
      const chunkMap = new Map();
      const fileDocs = [];

      // Fase 1: Desencriptar chunks
      let decryptedCount = 0;
      for (const row of result.rows) {
        const doc = row.doc;
        if (doc?.type === 'leaf') {
          try {
            const decrypted = await decryptHKDF(doc.data, this.config.passphrase, this.pbkdf2Salt);
            chunkMap.set(doc._id, Buffer.from(decrypted, 'base64'));
            decryptedCount++;
          } catch (e: any) {
            this.logger.log({
              action: 'pull_vault',
              status: 'error',
              message: `No se pudo desencriptar chunk ${doc._id}: ${e.message}`,
              scope: agentId
            });
          }
        } else if (doc?.type === 'plain' || doc?.type === 'newnote') {
          fileDocs.push(doc);
        }
      }

      // Fase 2: Reconstruir archivos (con validación de scope)
      let writtenCount = 0;
      let skippedCount = 0;

      for (const doc of fileDocs) {
        const relativePath = doc.path || doc._id;

        // **VALIDACIÓN P0**: Verificar ACL antes de escribir
        const scopeCheck = this.scopeValidator.isAllowed(relativePath, agentId);
        if (!scopeCheck.allowed) {
          this.logger.log({
            action: 'pull_vault',
            path: relativePath,
            status: 'error',
            message: `Ignorado (ACL): ${scopeCheck.reason}`,
            scope: agentId
          });
          skippedCount++;
          continue;
        }

        try {
          const fullPath = path.resolve(process.cwd(), relativePath);
          const dir = path.dirname(fullPath);

          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }

          const fileChunks = doc.children || [];
          const buffers = fileChunks
            .map((id: string) => chunkMap.get(id))
            .filter((b: any) => b !== undefined);

          if (buffers.length > 0) {
            fs.writeFileSync(fullPath, Buffer.concat(buffers));
            writtenCount++;
          }
        } catch (e: any) {
          this.logger.log({
            action: 'pull_vault',
            path: relativePath,
            status: 'error',
            message: `Fallo al escribir: ${e.message}`,
            scope: agentId
          });
        }
      }

      this.logger.log({
        action: 'pull_vault',
        status: 'success',
        message: `Completado: ${decryptedCount} chunks, ${writtenCount} archivos escritos, ${skippedCount} ignorados por ACL`,
        scope: agentId
      });

      return { 
        success: true, 
        message: "Vault reconstruido con éxito en el workspace.",
        decryptedChunks: decryptedCount,
        filesWritten: writtenCount,
        filesSkipped: skippedCount
      };
    } catch (err: any) {
      this.logger.log({
        action: 'pull_vault',
        status: 'error',
        message: `Fallo crítico: ${err.message}`,
        scope: agentId
      });
      throw err;
    }
  }

  /**
   * Obtener historial de auditoría (para debugging y monitoreo)
   */
  getAuditLog() {
    return this.logger.getAuditLog();
  }
}
