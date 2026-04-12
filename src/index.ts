import PouchDB from 'pouchdb';
import findPouchDBAdapter from 'pouchdb-adapter-http';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { encrypt as encryptHKDF, decrypt as decryptHKDF, decryptWithEphemeralSalt } from 'octagonal-wheels/encryption/hkdf';
import xxhash from 'xxhash-wasm';
import { retryWithBackoff, safeDbPut, safeDbGet, safeDbAllDocs, RetryableError } from './retry.js';
import { ConflictResolver, VersionManager, ConflictStrategy, FileMetadata } from './conflict.js';
import { WorkspaceWatcher, FileChangeEvent, WatcherOptions } from './watcher.js';
import { ThreeWayMerger, MarkdownMerger, JsonMerger, MergeStrategy } from './merge.js';
import { ChangeTracker, IncrementalSyncManager, ChangeSummary } from './incremental.js';
import { SyncScheduler, SyncSchedule } from './scheduler.js';

PouchDB.plugin(findPouchDBAdapter);

interface VaultSettings {
  couchDB_URI: string;
  couchDB_DBNAME: string;
  couchDB_USER: string;
  couchDB_PASSWORD: string;
  pbkdf2_salts?: string; // Base64-encoded salt
}

interface SyncAuditLog {
  timestamp?: number;
  action: 'sync_file' | 'pull_vault' | 'error' | 'init' | 'config';
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
  private enforceAcl: boolean;

  constructor(config: any) {
    this.enforceAcl = config.enforceAcl !== false;
    
    // Scopes predeterminados
    this.allowedScopes.set('raul', ['000', '001', '002', '003', '004', '005']);
    this.allowedScopes.set('sky', ['100', '101', '102', '103', '104']);
    this.allowedScopes.set('shared', ['200', '201']);

    // Sobreescribir con scopes personalizados si existen
    if (config.customScopes && typeof config.customScopes === 'object') {
      for (const [agent, scopes] of Object.entries(config.customScopes)) {
        if (Array.isArray(scopes)) {
          this.allowedScopes.set(agent, scopes.map(s => String(s)));
        }
      }
    }
  }

  /**
   * Validar si una ruta está permitida para este agente
   */
  isAllowed(filePath: string, agentId: string = 'sky'): { allowed: boolean; scope?: string; reason?: string } {
    if (!this.enforceAcl) {
      return { allowed: true, scope: 'root' };
    }

    const normalized = filePath.toLowerCase().replace(/\\/g, '/');
    const scopes = this.allowedScopes.get(agentId);

    if (!scopes) {
      return { allowed: false, reason: `Agente desconocido: ${agentId}` };
    }

    // Extraer prefijo (primer nivel de carpeta)
    const parts = normalized.split('/');
    const folderPrefix = parts[0];

    // Permitir acceso si la carpeta empieza con alguno de los scopes permitidos
    for (const scope of scopes) {
      if (folderPrefix.startsWith(scope)) {
        return { allowed: true, scope: folderPrefix };
      }
    }

    return { allowed: false, reason: `Ruta "${folderPrefix}" no permitida para el agente "${agentId}"` };
  }
}

export class ObsidianLiveSyncPlugin {
  private db: any;
  private config: any;
  private vaultSettings: any;
  private hasher: any;
  private logger: StructuredLogger;
  private scopeValidator: ScopeValidator;
  private pbkdf2Salts: Uint8Array[] = [];
  private e2eeEnabled: boolean = true;
  private watcher: WorkspaceWatcher | null = null;
  private conflictResolver: ConflictResolver;
  private versionManager: VersionManager;
  private fileMetadataCache: Map<string, FileMetadata> = new Map();
  
  // P2: Merge strategies, incremental sync, scheduling
  private mergeStrategy: MergeStrategy;
  private incrementalSyncManager: IncrementalSyncManager | null = null;
  private syncScheduler: SyncScheduler;
  private autoMergeEnabled: boolean;
  private workspaceRoot: string;

  // P3: Remote changes feed (CouchDB → OpenClaw real-time)
  private remoteChanges: any = null;
  private remoteChunkCache: Map<string, string> = new Map();

  constructor(config: any) {
    this.config = config;
    this.workspaceRoot = path.resolve(process.cwd(), config.vaultPath || '.');
    this.logger = new StructuredLogger();
    this.scopeValidator = new ScopeValidator(config);
    this.conflictResolver = new ConflictResolver(config.conflictStrategy || 'last-write-wins');
    this.versionManager = new VersionManager();
    
    // P2: Initialize merge strategy and scheduling
    this.mergeStrategy = config.mergeStrategy || 'line-based';
    this.autoMergeEnabled = config.autoMerge !== false; // Default: enabled
    this.syncScheduler = new SyncScheduler();
  }

  async initialize() {
    try {
      this.hasher = await xxhash();
      
      // Check for clean credentials first
      const hasCleanCreds = this.config.couchdb_url && this.config.couchdb_user && this.config.couchdb_password;

      if (hasCleanCreds) {
        this.logger.log({
          action: 'init',
          status: 'success',
          message: 'Arrancando usando credenciales limpias estáticas desde config.json'
        });
        
        this.vaultSettings = {
          couchDB_URI: this.config.couchdb_url,
          couchDB_USER: this.config.couchdb_user,
          couchDB_PASSWORD: this.config.couchdb_password,
          couchDB_DBNAME: this.config.couchdb_dbname || 'obsidian_livesync',
          pbkdf2_salts: this.config.pbkdf2_salts
        };
      } else if (this.config.setup_uri) {
        // Extraer settings del URI
        let encryptedData = this.config.setup_uri;
        if (encryptedData.includes('settings=')) {
          encryptedData = encryptedData.split('settings=')[1];
        }
        
        this.logger.log({
          action: 'init',
          status: 'success',
          message: `Desencriptando setup_uri por primera vez...`
        });

        encryptedData = decodeURIComponent(encryptedData);

        // Decodificar hasta llegar al formato esperado (%$...)
        let decodeCount = 0;
        while (encryptedData.includes('%') && !encryptedData.startsWith('%$') && decodeCount < 5) {
          try {
            const next = decodeURIComponent(encryptedData);
            if (next === encryptedData) break;
            encryptedData = next;
            decodeCount++;
          } catch (e) {
            break;
          }
        }

        // Si empieza con %24, es $ encodado. Debe ser %$ para la librería.
        if (encryptedData.startsWith('%24')) {
          encryptedData = '%' + decodeURIComponent(encryptedData);
        } else if (encryptedData.startsWith('$')) {
          encryptedData = '%' + encryptedData;
        }

        const decrypted = await decryptWithEphemeralSalt(encryptedData, this.config.passphrase);
        this.logger.log({
          action: 'init',
          status: 'success',
          message: `Decriptado exitoso. Longitud JSON: ${decrypted.length}`
        });
        
        this.vaultSettings = JSON.parse(decrypted) as VaultSettings;
        
        // Guardar las credenciales limpias en config.json usando fs
        try {
          const configPath = path.resolve(process.cwd(), 'config.json');
          if (fs.existsSync(configPath)) {
            const currentConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            currentConfig.couchdb_url = this.vaultSettings.couchDB_URI;
            currentConfig.couchdb_user = this.vaultSettings.couchDB_USER;
            currentConfig.couchdb_password = this.vaultSettings.couchDB_PASSWORD;
            currentConfig.couchdb_dbname = this.vaultSettings.couchDB_DBNAME;
            if (this.vaultSettings.pbkdf2_salts) {
              currentConfig.pbkdf2_salts = this.vaultSettings.pbkdf2_salts;
            }
            // Eliminar la URI encriptada pesada para futuras cargas
            delete currentConfig.setup_uri;
            
            fs.writeFileSync(configPath, JSON.stringify(currentConfig, null, 2), 'utf8');
            console.log('[INIT] Credenciales extraídas y guardadas de forma limpia en config.json de manera permanente.');
            
            // Refrescar configuración en memoria
            this.config = currentConfig;
          }
        } catch (err) {
          console.error('[INIT] Error al intentar guardar las credenciales limpias en config.json:', err);
        }
      } else {
        throw new Error('Faltan datos de conexión. Se requiere couchdb_url, couchdb_user, couchdb_password y couchdb_dbname en config.json, o un setup_uri válido.');
      }

      // Allow overriding the CouchDB URI via config (e.g. use local IP instead of external domain)
      if (this.config.couchdb_uri_override) {
        console.log(`[INIT] URI override aplicado: ${this.config.couchdb_uri_override}`);
        this.vaultSettings.couchDB_URI = this.config.couchdb_uri_override;
      }

      // Allow overriding the CouchDB database name via config
      if (this.config.couchdb_dbname_override) {
        console.log(`[INIT] DBNAME override aplicado: ${this.config.couchdb_dbname_override}`);
        this.vaultSettings.couchDB_DBNAME = this.config.couchdb_dbname_override;
      }
      
      // E2EE flag: if explicitly false, skip all encryption
      this.e2eeEnabled = this.config.e2ee !== false;
      console.log(`[INIT] E2EE: ${this.e2eeEnabled}`);
      
      console.log('--- ENCRYPTION VALUES (SAFE) ---');
      for (const [k, v] of Object.entries(this.vaultSettings)) {
        if (k.toLowerCase().includes('salt') || k.toLowerCase().includes('passphrase')) {
          const val = String(v);
          console.log(`${k}: ${val.substring(0, 5)}... (len: ${val.length})`);
        }
      }
      
      this.e2eeEnabled = this.config.e2ee !== false;
      if (this.e2eeEnabled) {
        const foundSaltsBase64 = new Set<string>();
        if (this.config.salt) foundSaltsBase64.add(this.config.salt);
        if (this.vaultSettings.pbkdf2_salts) foundSaltsBase64.add(this.vaultSettings.pbkdf2_salts);
        for (const [k, v] of Object.entries(this.vaultSettings)) {
          if (k.toLowerCase().includes('salt') && typeof v === 'string') {
            foundSaltsBase64.add(v);
          }
        }
        for (const s of foundSaltsBase64) {
          try { this.pbkdf2Salts.push(new Uint8Array(Buffer.from(s, 'base64'))); } catch (e) {}
        }
        console.log(`[INIT] ${this.pbkdf2Salts.length} sales PBKDF2 preparadas.`);
      } else {
        console.log('[INIT] E2EE desactivado.');
      }
      
      const remoteUrl = `${this.vaultSettings.couchDB_URI}/${this.vaultSettings.couchDB_DBNAME}`;
      this.db = new PouchDB(remoteUrl, {
        auth: { 
          username: this.vaultSettings.couchDB_USER, 
          password: this.vaultSettings.couchDB_PASSWORD 
        }
      });

      // Salt from _local (only if E2EE enabled)
      if (this.e2eeEnabled) {
        try {
          const localParams = await safeDbGet(this.db, '_local/obsidian_livesync_sync_parameters', 1);
          if (localParams && localParams.pbkdf2salt) {
            const dbSalt = localParams.pbkdf2salt;
            if (!this.pbkdf2Salts.some(s => Buffer.from(s).toString('base64') === dbSalt)) {
              console.log(`[INIT] Nueva sal encontrada en DB: ${dbSalt.substring(0, 10)}...`);
              this.pbkdf2Salts.unshift(new Uint8Array(Buffer.from(dbSalt, 'base64')));
            }
          }
        } catch (e) {
          console.warn('[INIT] No se pudo obtener _local/obsidian_livesync_sync_parameters');
        }
      }
      this.logger.log({
        action: 'sync_file',
        status: 'success',
        message: `Plugin inicializado. Conectado a CouchDB.`,
        scope: 'init'
      });

      // P1: Iniciar file watcher automáticamente si está configurado
      if (this.config.autoWatch !== false) {
        await this.startAutoWatch();
      }

      // P3: Iniciar remote watcher (CouchDB → local) si no está desactivado
      if (this.config.remoteWatch !== false) {
        await this.startRemoteWatch();
      }

      // P2: Initialize incremental sync if enabled
      if (this.config.incrementalSync !== false) {
        this.initIncrementalSync();
      }

      // P2: Setup sync schedules if configured
      if (this.config.schedules && Array.isArray(this.config.schedules)) {
        this.setupSchedules(this.config.schedules);
      }
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
   * P1: Start automatic file watcher
   */
  async startAutoWatch() {
    try {
      const watcherOptions: WatcherOptions = {
        watched: this.config.watchedScopes || ['100', '101', '102', '103', '104'],
        debounceMs: this.config.watcherDebounceMs || 500
      };

      this.watcher = new WorkspaceWatcher(this.workspaceRoot, watcherOptions);
      await this.watcher.start((events) => this.onFilesChanged(events));

      this.logger.log({
        action: 'sync_file',
        status: 'success',
        message: `File watcher iniciado. Monitoreando cambios automáticos.`,
        scope: 'init'
      });
    } catch (err: any) {
      this.logger.log({
        action: 'error',
        status: 'error',
        message: `Fallo al iniciar file watcher: ${err.message}`,
        scope: 'init'
      });
      // No throw, watcher es opcional
    }
  }

  /**
   * P1: Handle file changes from watcher
   */
  private async onFilesChanged(events: FileChangeEvent[]) {
    for (const event of events) {
      try {
        if (event.event === 'unlink') {
          // TODO: Handle file deletion (mark as deleted in DB)
          console.log(`[AutoSync] Archivo eliminado: ${event.filePath}`);
        } else {
          // Auto-sync on add/change
          const result = await this.obsidian_sync_file({ filePath: event.filePath });
          this.logger.log({
            action: 'sync_file',
            path: event.filePath,
            status: 'success',
            message: `Auto-sincronizado: ${event.event}`,
            scope: event.filePath.split('/')[0]
          });
        }
      } catch (err: any) {
        this.logger.log({
          action: 'sync_file',
          path: event.filePath,
          status: 'error',
          message: `Auto-sync fallido: ${err.message}`,
          scope: event.filePath.split('/')[0]
        });
      }
    }
  }

  /**
   * P1: Stop file watcher
   */
  async stopAutoWatch() {
    if (this.watcher) {
      await this.watcher.stop();
      this.watcher = null;
    }
  }

  /**
   * P3: Start remote changes feed — CouchDB → local (real-time, like native LiveSync)
   */
  async startRemoteWatch() {
    if (this.remoteChanges) return;

    const agentId = this.config.agentId || 'sky';

    this.remoteChanges = this.db.changes({
      live: true,
      since: 'now',
      include_docs: true
    });

    this.remoteChanges
      .on('change', async (change: any) => {
        const doc = change.doc;
        if (!doc || doc._deleted) return;
        try {
          if (doc.type === 'leaf' && doc.data) {
            // Cache the chunk for when the file doc arrives
            const decrypted = await this.tryDecrypt(doc.data);
            if (decrypted !== null) {
              this.remoteChunkCache.set(doc._id, decrypted);
            }
          } else if (doc.type === 'plain' || doc.type === 'newnote' || doc.type === 'notes' || (doc.children && doc.children.length > 0)) {
            await this.applyRemoteFile(doc, agentId);
          }
        } catch (err: any) {
          this.logger.log({
            action: 'pull_vault',
            path: doc.path || doc._id,
            status: 'error',
            message: `[RemoteWatch] Error: ${err.message}`,
            scope: agentId
          });
        }
      })
      .on('error', (err: any) => {
        console.error('[RemoteWatch] Error en changes feed:', err);
        this.remoteChanges = null;
      });

    this.logger.log({
      action: 'init',
      status: 'success',
      message: 'Remote watcher iniciado. Escuchando cambios desde CouchDB en tiempo real.',
      scope: 'init'
    });
    console.log('[RemoteWatch] Escuchando cambios remotos en CouchDB (live)...');
  }

  /**
   * P3: Apply a remote file doc to local workspace
   */
  private async applyRemoteFile(doc: any, agentId: string) {
    const relativePath = doc.path || doc._id;
    if (!relativePath || relativePath.startsWith('_')) return;

    const scopeCheck = this.scopeValidator.isAllowed(relativePath, agentId);
    if (!scopeCheck.allowed) return;

    const fileChunks: string[] = doc.children || [];
    const isBinary = doc.type === 'newnote' || /\.(png|jpg|jpeg|pdf|zip|7z|rar|mp4|mov|avi)$/i.test(relativePath);
    const buffers: Buffer[] = [];

    for (const chunkId of fileChunks) {
      let data = this.remoteChunkCache.get(chunkId);
      if (data === undefined) {
        // Chunk not cached yet — fetch from DB
        try {
          const chunkDoc = await safeDbGet(this.db, chunkId, 2);
          if (chunkDoc?.data) {
            const decrypted = await this.tryDecrypt(chunkDoc.data);
            if (decrypted !== null) {
              this.remoteChunkCache.set(chunkId, decrypted);
              data = decrypted;
            }
          }
        } catch (_e) { /* chunk missing */ }
      }
      if (data !== undefined) {
        buffers.push(isBinary ? Buffer.from(data, 'base64') : Buffer.from(data, 'utf-8'));
      }
    }

    // Fallback: inline data
    if (buffers.length === 0 && doc.data) {
      const decrypted = await this.tryDecrypt(doc.data);
      if (decrypted !== null) {
        buffers.push(isBinary ? Buffer.from(decrypted, 'base64') : Buffer.from(decrypted, 'utf-8'));
      }
    }

    if (buffers.length > 0) {
      const fullPath = path.resolve(this.workspaceRoot, relativePath);
      const dir = path.dirname(fullPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(fullPath, Buffer.concat(buffers as any) as any);
      console.log(`[RemoteWatch] ✓ ${relativePath}`);
      this.logger.log({
        action: 'pull_vault',
        path: relativePath,
        status: 'success',
        message: `[RemoteWatch] Sincronizado desde CouchDB`,
        scope: agentId
      });
    }
  }

  /**
   * P3: Stop remote changes feed
   */
  async stopRemoteWatch() {
    if (this.remoteChanges) {
      this.remoteChanges.cancel();
      this.remoteChanges = null;
      this.remoteChunkCache.clear();
      console.log('[RemoteWatch] Detenido.');
    }
    return { success: true, message: 'Remote watcher detenido.' };
  }

  /**
   * P3: Get remote watcher status
   */
  getRemoteWatcherStatus() {
    return {
      active: this.remoteChanges !== null,
      cachedChunks: this.remoteChunkCache.size
    };
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
      const fullPath = path.resolve(this.workspaceRoot, filePath);
      if (!fs.existsSync(fullPath)) {
        throw new Error(`Archivo no encontrado: ${filePath}`);
      }

      const content = fs.readFileSync(fullPath);
      const localContent = content.toString('utf-8'); // Define localContent for potential merge
      // Salt check only needed for E2EE — without salts, content is stored as plain text
      // if (this.pbkdf2Salts.length === 0) {
      //   throw new Error('Salt no inicializado. Ejecuta initialize() primero.');
      // }

      // Chunking y encripción (using helper)
      const { children, chunkCount: initialChunkCount } = await this.chunkAndEncrypt(content);
      let chunkCount = initialChunkCount;

      // Crear/actualizar documento (con P1: conflict detection)
      const docId = filePath.toLowerCase().replace(/\\/g, '/');
      let existingDoc: any = {};
      try {
        existingDoc = await safeDbGet(this.db, docId, 2);
      } catch (err: any) {
        if (err.status !== 404) throw err;
      }

      const contentHash = crypto.createHash('sha256').update(content as any).digest('hex');
      const newDoc = {
        ...existingDoc,
        _id: docId,
        path: filePath,
        children: children,
        ctime: existingDoc.ctime || Date.now(),
        mtime: Date.now(),
        size: content.length,
        hash: contentHash,
        version: (existingDoc.version || 0) + 1,
        type: 'plain',
        eden: {}
      };

      // P1: Detect conflicts
      if (existingDoc._id) {
        const localMeta: FileMetadata = {
          _id: docId,
          path: filePath,
          mtime: Date.now(),
          hash: contentHash,
          size: content.length,
          version: newDoc.version
        };

        const remoteMeta: FileMetadata = {
          _id: existingDoc._id,
          path: existingDoc.path,
          mtime: existingDoc.mtime || 0,
          hash: existingDoc.hash || '',
          size: existingDoc.size || 0,
          version: existingDoc.version || 0
        };

        if (this.conflictResolver.hasConflict(localMeta, remoteMeta)) {
          const resolution = this.conflictResolver.resolve(localMeta, remoteMeta);

          // Update version history
          const updatedMeta = this.versionManager.recordVersion(remoteMeta, 'remote', true);
          newDoc.versions = updatedMeta.versions;

          // P2: Attempt intelligent merge if enabled
          if (this.autoMergeEnabled) {
            try {
              // Reconstruct remote content from chunks
              const remoteContent = await this.fetchRemoteContent(existingDoc);
              const baseContent = existingDoc.baseContent || ''; 
              
              const mergeResult = await this.mergeConflict({
                filePath,
                localContent,
                remoteContent,
                baseContent
              });

              if (!mergeResult.hasConflicts) {
                // Merged successfully, use merged content
                // We need to re-chunk the merged content
                const mergedBuffer = Buffer.from(mergeResult.merged, 'utf-8');
                const { children: mergedChildren, chunkCount: mergedChunkCount } = await this.chunkAndEncrypt(mergedBuffer);
                
                newDoc.children = mergedChildren;
                newDoc.size = mergedBuffer.length;
                newDoc.hash = crypto.createHash('sha256').update(mergedBuffer as any).digest('hex');
                chunkCount = mergedChunkCount;

                this.logger.log({
                  action: 'sync_file',
                  path: filePath,
                  scope: scopeCheck.scope,
                  status: 'success',
                  message: `Conflicto auto-resuelto con merge inteligente`
                });
              } else {
                // Merge has conflicts, fall back to strategy
                this.logger.log({
                  action: 'sync_file',
                  path: filePath,
                  scope: scopeCheck.scope,
                  status: 'success',
                  message: `Auto-merge falló (conflictos detectados). Aplicando estrategia: ${resolution.winner}`
                });
                if (resolution.winner === 'remote') {
                  return { success: true, message: 'Conflict resolved: using remote version.' };
                }
              }
            } catch (err: any) {
              this.logger.log({
                action: 'sync_file',
                path: filePath,
                scope: scopeCheck.scope,
                status: 'error',
                message: `Error en auto-merge: ${err.message}. Usando estrategia de conflicto.`
              });
            }
          } else {
            this.logger.log({
              action: 'sync_file',
              path: filePath,
              scope: scopeCheck.scope,
              status: 'success',
              message: `Conflicto detectado: ${resolution.action}. Aplicando: ${resolution.winner}`
            });

            if (resolution.winner === 'remote') {
              return { success: true, message: 'Conflict resolved: remote wins.' };
            }

            // Versioning: save old version as a separate doc
            await safeDbPut(this.db, {
              _id: `${docId}.v${remoteMeta.version}`,
              path: filePath,
              children: existingDoc.children,
              mtime: existingDoc.mtime,
              hash: existingDoc.hash,
              version: remoteMeta.version,
              type: 'plain',
              archived: true
            }, 1);
          }
        } else {
          // No conflict, just preserve version history if it exists
          newDoc.versions = existingDoc.versions || [];
        }
      }

      await safeDbPut(this.db, newDoc, 3);

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
   * Helper: Intentar desencriptar con varias estrategias (basado en pull_vault_direct.mjs)
   */
  private async tryDecrypt(data: string): Promise<string | null> {
    if (!data) return null;
    const passphrase = this.config.passphrase;

    // 1. HKDF (%=...) - Intentar con todas las sales
    if (data.startsWith('%=')) {
      for (const salt of this.pbkdf2Salts) {
        try {
          return await decryptHKDF(data, passphrase, salt as any);
        } catch (e) { /* continue */ }
      }
      // Intentar sin salt si todos fallan
      try {
        return await decryptHKDF(data, passphrase, null as any);
      } catch (e) { /* ignore */ }
    }

    // 2. Ephemeral (%$...)
    if (data.startsWith('%$')) {
      try {
        return await decryptWithEphemeralSalt(data, passphrase);
      } catch (e) { /* ignore */ }
    }

    // 3. Si no tiene prefijo conocido, intentar devolverlo tal cual 
    // (podría ser un chunk no encriptado o con prefijo antiguo %)
    if (!data.startsWith('%')) {
       return data;
    }

    return null;
  }

  /**
   * Tool: Descargar vault completo desde CouchDB
   * Respeta scope: cada agente solo puede escribir en su carpeta
   */
  async obsidian_pull_vault() {
    const agentId = this.config.agentId || 'sky';

    try {
      this.logger.log({
        action: 'pull_vault',
        status: 'success',
        message: 'Iniciando descarga desde CouchDB...',
        scope: agentId
      });

      // P1: Fetch in batches to avoid memory/timeout issues
      console.log(`[INFO] Obteniendo lista de documentos...`);
      const allIdsResult = await safeDbAllDocs(this.db, { include_docs: false }, 3);
      const allIds = allIdsResult.rows.map((r: any) => r.id);
      
      const chunkMap = new Map<string, string>();
      const fileDocs: any[] = [];
      let decryptedCount = 0;
      let failedChunks = 0;

      const BATCH_SIZE = 500;
      console.log(`[INFO] Procesando ${allIds.length} documentos en lotes de ${BATCH_SIZE}...`);

      for (let i = 0; i < allIds.length; i += BATCH_SIZE) {
        const batchIds = allIds.slice(i, i + BATCH_SIZE);
        const batchResult = await this.db.allDocs({
          keys: batchIds,
          include_docs: true
        });

        for (const row of batchResult.rows) {
          const doc = row.doc;
          if (!doc) continue;

          if (doc.type === 'leaf' && doc.data) {
            const decrypted = await this.tryDecrypt(doc.data);
            if (decrypted !== null) {
              // Guardamos el string desencriptado (que puede ser base64 o texto plano)
              chunkMap.set(doc._id, decrypted);
              decryptedCount++;
            } else {
              failedChunks++;
            }
          } else if (doc.type === 'plain' || doc.type === 'newnote' || doc.type === 'notes' || (doc.children && doc.children.length > 0)) {
            fileDocs.push(doc);
          }
        }
        
        console.log(`  [PROGRESS] Procesados ${Math.min(i + BATCH_SIZE, allIds.length)}/${allIds.length} documentos...`);
      }

      this.logger.log({
        action: 'pull_vault',
        status: 'success',
        message: `Chunks procesados: ${decryptedCount} OK, ${failedChunks} fallidos. Archivos detectados: ${fileDocs.length}`,
        scope: agentId
      });

      // Fase 2: Reconstruir archivos (con validación de scope)
      let writtenCount = 0;
      let skippedCount = 0;
      let errorCount = 0;

      for (const doc of fileDocs) {
        const relativePath = doc.path || doc._id;
        if (!relativePath || relativePath.startsWith('_')) {
          skippedCount++;
          continue;
        }

        // **VALIDACIÓN P0**: Verificar ACL antes de escribir
        const scopeCheck = this.scopeValidator.isAllowed(relativePath, agentId);
        if (!scopeCheck.allowed) {
          skippedCount++;
          continue;
        }

        try {
          const fullPath = path.resolve(this.workspaceRoot, relativePath);
          const dir = path.dirname(fullPath);

          const fileChunks = doc.children || [];
          let buffers: Buffer[] = [];

          const isBinary = doc.type === 'newnote' || (relativePath.match(/\.(png|jpg|jpeg|pdf|zip|7z|rar|mp4|mov|avi)$/i));

          if (fileChunks.length > 0) {
            // Reconstruir desde chunks
            for (const id of fileChunks) {
              const data = chunkMap.get(id);
              if (data !== undefined) {
                if (isBinary) {
                  buffers.push(Buffer.from(data, 'base64'));
                } else {
                  buffers.push(Buffer.from(data, 'utf-8'));
                }
              }
            }
          } else if (doc.data) {
            // Reconstruir desde datos directos
            const decrypted = await this.tryDecrypt(doc.data);
            if (decrypted !== null) {
              if (isBinary) {
                buffers.push(Buffer.from(decrypted, 'base64'));
              } else {
                buffers.push(Buffer.from(decrypted, 'utf-8'));
              }
            }
          }

          if (buffers.length > 0) {
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(fullPath, Buffer.concat(buffers as any) as any);
            writtenCount++;
            
            if (writtenCount % 50 === 0) {
              console.log(`  [PROGRESS] Escritos ${writtenCount} archivos...`);
            }
          } else {
            skippedCount++;
          }
        } catch (e: any) {
          errorCount++;
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
        message: `Completado: ${writtenCount} archivos escritos, ${skippedCount} omitidos, ${errorCount} errores`,
        scope: agentId
      });

      return { 
        success: true, 
        message: "Vault reconstruido con éxito.",
        decryptedChunks: decryptedCount,
        filesWritten: writtenCount,
        filesSkipped: skippedCount,
        errors: errorCount
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
   * Helper: Encrypt and chunk content
   */
  private async chunkAndEncrypt(content: Buffer): Promise<{ children: string[], chunkCount: number }> {
    const CHUNK_SIZE = 50 * 1024;
    const children: string[] = [];
    let chunkCount = 0;
    const e2eeEnabled = this.pbkdf2Salts.length > 0;

    for (let i = 0; i < content.length; i += CHUNK_SIZE) {
      const chunkData = content.slice(i, i + CHUNK_SIZE);
      const chunkId = `h:+${this.hasher.h64(chunkData.toString('binary')).toString(36)}`;

      let chunkDataStr: string;
      let eField: boolean | undefined;
      if (e2eeEnabled) {
        const encryptionSalt = this.pbkdf2Salts[0];
        chunkDataStr = await encryptHKDF(
          chunkData.toString('base64'),
          this.config.passphrase,
          encryptionSalt as any
        );
        eField = true;
      } else {
        chunkDataStr = chunkData.toString('utf8');
        eField = undefined;
      }

      try {
        const chunkDoc: any = {
          _id: chunkId,
          data: chunkDataStr,
          type: 'leaf'
        };
        if (eField !== undefined) chunkDoc.e_ = eField;
        await safeDbPut(this.db, chunkDoc, 2);
        chunkCount++;
      } catch (err: any) {
        if (err.status !== 409) throw err;
      }
      children.push(chunkId);
    }
    return { children, chunkCount };
  }

  /**
   * Helper: Reconstruct remote content from CouchDB
   */
  private async fetchRemoteContent(doc: any): Promise<string> {
    const children = doc.children || [];
    const buffers: Buffer[] = [];

    for (const childId of children) {
      const chunkDoc = await safeDbGet(this.db, childId, 2);
      const decrypted = await this.tryDecrypt(chunkDoc.data);
      if (decrypted) {
        buffers.push(Buffer.from(decrypted, 'base64'));
      } else {
        throw new Error(`Failed to decrypt chunk ${childId}`);
      }
    }

    return Buffer.concat(buffers as any).toString('utf-8');
  }

  /**
   * Obtener historial de auditoría (para debugging y monitoreo)
   */
  getAuditLog() {
    return this.logger.getAuditLog();
  }

  /**
   * P3: Read a file from the local vault
   */
  async obsidian_read_file({ filePath }: { filePath: string }) {
    const agentId = this.config.agentId || 'sky';
    const scopeCheck = this.scopeValidator.isAllowed(filePath, agentId);
    if (!scopeCheck.allowed) {
      throw new Error(`[ACL] ${scopeCheck.reason}`);
    }

    const fullPath = path.resolve(this.workspaceRoot, filePath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Archivo no encontrado: ${filePath}`);
    }

    const stat = fs.statSync(fullPath);
    const isBinary = /\.(png|jpg|jpeg|pdf|zip|7z|rar|mp4|mov|avi)$/i.test(filePath);
    if (isBinary) {
      return { success: true, filePath, binary: true, sizeBytes: stat.size };
    }

    const content = fs.readFileSync(fullPath, 'utf-8');
    return {
      success: true,
      filePath,
      content,
      sizeBytes: stat.size,
      modifiedAt: new Date(stat.mtimeMs).toISOString()
    };
  }

  /**
   * P3: Search text across local vault files
   */
  async obsidian_search({ query, scope, maxResults = 20 }: { query: string; scope?: string; maxResults?: number }) {
    if (!query || query.trim() === '') {
      throw new Error('query no puede estar vacía');
    }

    const agentId = this.config.agentId || 'sky';
    const searchRoot = this.workspaceRoot;
    const results: { filePath: string; matches: { line: number; text: string }[] }[] = [];
    const queryLower = query.toLowerCase();

    const walkDir = (dir: string) => {
      if (results.length >= maxResults) return;
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }

      for (const entry of entries) {
        if (results.length >= maxResults) break;
        const fullPath = path.join(dir, entry.name);
        const relativePath = path.relative(searchRoot, fullPath).replace(/\\/g, '/');

        if (entry.isDirectory()) {
          if (['.obsidian', 'node_modules', '.git'].includes(entry.name)) continue;
          walkDir(fullPath);
        } else if (entry.isFile() && /\.(md|txt|json)$/i.test(entry.name)) {
          // ACL check
          const scopeCheck = this.scopeValidator.isAllowed(relativePath, agentId);
          if (!scopeCheck.allowed) continue;
          // Optional scope filter
          if (scope && !relativePath.startsWith(scope)) continue;

          try {
            const lines = fs.readFileSync(fullPath, 'utf-8').split('\n');
            const matches = lines
              .map((text, i) => ({ line: i + 1, text }))
              .filter(({ text }) => text.toLowerCase().includes(queryLower));

            if (matches.length > 0) {
              results.push({ filePath: relativePath, matches: matches.slice(0, 5) });
            }
          } catch { /* skip unreadable files */ }
        }
      }
    };

    walkDir(searchRoot);

    return {
      success: true,
      query,
      totalFiles: results.length,
      results
    };
  }

  /**
   * P1: Get file version history
   */
  async getVersionHistory({ filePath }: { filePath: string }) {
    const docId = filePath.toLowerCase().replace(/\\/g, '/');
    try {
      const doc = await safeDbGet(this.db, docId, 2);
      return {
        success: true,
        path: filePath,
        version: doc.version || 1,
        mtime: doc.mtime,
        versions: doc.versions || []
      };
    } catch (err: any) {
      if (err.status === 404) {
        return {
          success: false,
          message: `Archivo no encontrado: ${filePath}`
        };
      }
      throw err;
    }
  }

  /**
   * P1: Revert to a previous version
   */
  async revertToVersion({ filePath, versionNumber }: { filePath: string; versionNumber: number }) {
    const agentId = this.config.agentId || 'sky';

    // Validar ACL
    const scopeCheck = this.scopeValidator.isAllowed(filePath, agentId);
    if (!scopeCheck.allowed) {
      throw new Error(`[ACL VIOLATION] ${scopeCheck.reason}`);
    }

    try {
      const docId = filePath.toLowerCase().replace(/\\/g, '/');
      const currentDoc = await safeDbGet(this.db, docId, 2);

      const versionedDocId = `${docId}.v${versionNumber}`;
      const versionedDoc = await safeDbGet(this.db, versionedDocId, 2);

      if (!versionedDoc) {
        throw new Error(`Versión ${versionNumber} no encontrada`);
      }

      // Revert: restore versioned content
      const revertedDoc = {
        ...currentDoc,
        _id: docId,
        children: versionedDoc.children,
        mtime: Date.now(),
        hash: versionedDoc.hash,
        version: currentDoc.version + 1,
        reverted_from_version: versionNumber
      };

      await safeDbPut(this.db, revertedDoc, 3);

      this.logger.log({
        action: 'sync_file',
        path: filePath,
        scope: scopeCheck.scope,
        status: 'success',
        message: `Revertido a versión ${versionNumber}`
      });

      return {
        success: true,
        message: `Revertido a versión ${versionNumber}`,
        newVersion: revertedDoc.version
      };
    } catch (err: any) {
      this.logger.log({
        action: 'sync_file',
        path: filePath,
        status: 'error',
        message: `Fallo al revertir: ${err.message}`,
        scope: agentId
      });
      throw err;
    }
  }

  /**
   * P1: Set conflict resolution strategy
   */
  setConflictStrategy(strategy: ConflictStrategy) {
    this.conflictResolver.setStrategy(strategy);
    this.logger.log({
      action: 'sync_file',
      status: 'success',
      message: `Estrategia de conflictos establecida: ${strategy}`,
      scope: 'config'
    });
  }

  /**
   * P1: Get watcher status
   */
  getWatcherStatus() {
    return {
      watching: this.watcher?.isWatching() || false,
      pendingChanges: this.watcher?.getPendingChanges() || []
    };
  }

  /**
   * P2: Initialize incremental sync
   */
  private initIncrementalSync() {
    try {
      this.incrementalSyncManager = new IncrementalSyncManager(
        this.workspaceRoot,
        this.config.incrementalBatchSize || 50,
        this.config.incrementalMinDelayMs || 1000
      );

      this.logger.log({
        action: 'sync_file',
        status: 'success',
        message: `Incremental sync inicializado.`,
        scope: 'init'
      });
    } catch (err: any) {
      this.logger.log({
        action: 'error',
        status: 'error',
        message: `Fallo al inicializar incremental sync: ${err.message}`,
        scope: 'init'
      });
    }
  }

  /**
   * P2: Get next batch of files to sync (incremental)
   */
  async getNextSyncBatch() {
    if (!this.incrementalSyncManager) {
      return {
        success: false,
        message: 'Incremental sync not enabled'
      };
    }

    const watchedScopes = this.config.watchedScopes || ['100', '101', '102', '103', '104'];
    const batch = this.incrementalSyncManager.getNextBatch(watchedScopes);
    if (!batch) {
      return {
        success: false,
        message: 'No pending changes or too soon to sync'
      };
    }

    return {
      success: true,
      files: batch.files,
      summary: batch.summary
    };
  }

  /**
   * P2: Sync a batch of files
   */
  async syncBatch({ files }: { files: string[] }) {
    const agentId = this.config.agentId || 'sky';
    const results = {
      synced: [] as string[],
      failed: [] as { path: string; error: string }[],
      skipped: [] as string[]
    };

    for (const filePath of files) {
      try {
        // Validate ACL
        const scopeCheck = this.scopeValidator.isAllowed(filePath, agentId);
        if (!scopeCheck.allowed) {
          results.skipped.push(filePath);
          continue;
        }

        await this.obsidian_sync_file({ filePath });
        results.synced.push(filePath);
      } catch (err: any) {
        results.failed.push({
          path: filePath,
          error: err.message
        });
      }
    }

    // Mark batch as synced
    if (this.incrementalSyncManager) {
      this.incrementalSyncManager.markBatchSynced(results.synced);
    }

    this.logger.log({
      action: 'sync_file',
      status: results.failed.length > 0 ? 'error' : 'success',
      message: `Batch sync: ${results.synced.length} synced, ${results.failed.length} failed, ${results.skipped.length} skipped`
    });

    return results;
  }

  /**
   * P2: Merge two versions intelligently
   */
  async mergeConflict({
    filePath,
    localContent,
    remoteContent,
    baseContent
  }: {
    filePath: string;
    localContent: string;
    remoteContent: string;
    baseContent?: string;
  }) {
    const base = baseContent || '';

    let merged: { merged: string; conflicts: boolean };

    // Choose merge strategy based on file type
    if (filePath.endsWith('.md')) {
      merged = MarkdownMerger.merge(localContent, remoteContent, base);
    } else if (filePath.endsWith('.json')) {
      try {
        const local = JSON.parse(localContent);
        const remote = JSON.parse(remoteContent);
        const result = JsonMerger.merge(local, remote);
        merged = {
          merged: JSON.stringify(result.merged, null, 2),
          conflicts: result.conflicts.length > 0
        };
      } catch {
        // Fallback to text merge
        merged = ThreeWayMerger.merge(base, localContent, remoteContent);
      }
    } else {
      // Default: 3-way merge
      merged = ThreeWayMerger.merge(base, localContent, remoteContent);
    }

    this.logger.log({
      action: 'sync_file',
      path: filePath,
      status: merged.conflicts ? 'error' : 'success',
      message: `Merge completado. Conflictos: ${merged.conflicts}`
    });

    return {
      success: !merged.conflicts,
      merged: merged.merged,
      hasConflicts: merged.conflicts
    };
  }

  /**
   * P2: Setup sync schedules
   */
  private setupSchedules(scheduleConfigs: any[]) {
    for (const config of scheduleConfigs) {
      try {
        if (config.type === 'interval') {
          this.syncScheduler.addIntervalSchedule(config.name, config.intervalMs);
        } else if (config.type === 'cron') {
          this.syncScheduler.addCronSchedule(config.name, config.cronExpression);
        }

        this.logger.log({
          action: 'sync_file',
          status: 'success',
          message: `Schedule "${config.name}" registered.`,
          scope: 'config'
        });
      } catch (err: any) {
        this.logger.log({
          action: 'error',
          status: 'error',
          message: `Failed to setup schedule "${config.name}": ${err.message}`,
          scope: 'config'
        });
      }
    }

    // Start scheduler
    this.syncScheduler.start((scheduleName) => this.onScheduledSync(scheduleName));
  }

  /**
   * P2: Handle scheduled sync
   */
  private async onScheduledSync(scheduleName: string) {
    this.logger.log({
      action: 'sync_file',
      status: 'success',
      message: `Scheduled sync triggered: ${scheduleName}`
    });

    // Get next batch and sync
    const batch = await this.getNextSyncBatch();
    if (batch.success && batch.files) {
      await this.syncBatch({ files: batch.files });
    }
  }

  /**
   * P2: Get list of schedules
   */
  getSchedules() {
    return this.syncScheduler.getSchedules();
  }

  /**
   * P2: Add a new sync schedule
   */
  addSchedule({ name, type, intervalMs, cronExpression }: {
    name: string;
    type: 'interval' | 'cron';
    intervalMs?: number;
    cronExpression?: string;
  }) {
    try {
      if (type === 'interval' && intervalMs) {
        this.syncScheduler.addIntervalSchedule(name, intervalMs);
      } else if (type === 'cron' && cronExpression) {
        this.syncScheduler.addCronSchedule(name, cronExpression);
      } else {
        throw new Error('Invalid schedule configuration');
      }

      this.logger.log({
        action: 'sync_file',
        status: 'success',
        message: `Schedule added: ${name}`,
        scope: 'config'
      });

      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * P2: Enable/disable a schedule
   */
  setScheduleEnabled(name: string, enabled: boolean) {
    this.syncScheduler.setEnabled(name, enabled);
    return { success: true };
  }

  /**
   * P2: Trigger manual sync for a schedule
   */
  async triggerSchedule(name: string) {
    await this.syncScheduler.triggerManual(name);
    return { success: true };
  }

  /**
   * P2: Stop scheduler
   */
  stopScheduler() {
    this.syncScheduler.stop();
    return { success: true };
  }

  /**
   * P2: Get incremental sync stats
   */
  getIncrementalSyncStats() {
    if (!this.incrementalSyncManager) {
      return { enabled: false };
    }

    return {
      enabled: true,
      stats: this.incrementalSyncManager.getStats()
    };
  }

  /**
   * P2: Reset incremental sync tracking
   */
  resetIncrementalSyncTracking() {
    if (!this.incrementalSyncManager) {
      return { success: false, message: 'Incremental sync not enabled' };
    }

    this.incrementalSyncManager.reset();
    return { success: true };
  }
}

// ─── OpenClaw Plugin Entry Point ─────────────────────────────────────────────
export default function(api: any) {
  const plugin = new ObsidianLiveSyncPlugin(api.config);
  let initialized = false;

  const ensureInit = async () => {
    if (!initialized) {
      await plugin.initialize();
      initialized = true;
    }
  };

  api.registerTool({
    name: 'obsidian_sync_file',
    description: 'Syncs a local file from the workspace to the Obsidian vault in CouchDB. Enforces ACL by agent scope.',
    parameters: { type: 'object', properties: { filePath: { type: 'string' } }, required: ['filePath'] },
    async execute(_id: string, params: any) { await ensureInit(); return plugin.obsidian_sync_file(params); }
  });

  api.registerTool({
    name: 'obsidian_pull_vault',
    description: 'Downloads the entire Obsidian vault from CouchDB to the local workspace.',
    parameters: { type: 'object', properties: {} },
    async execute(_id: string) { await ensureInit(); return plugin.obsidian_pull_vault(); }
  });

  api.registerTool({
    name: 'getAuditLog',
    description: 'Retrieves the sync audit log.',
    parameters: { type: 'object', properties: {} },
    execute(_id: string) { return plugin.getAuditLog(); }
  });

  api.registerTool({
    name: 'getVersionHistory',
    description: 'Get version history for a file.',
    parameters: { type: 'object', properties: { filePath: { type: 'string' } }, required: ['filePath'] },
    async execute(_id: string, params: any) { await ensureInit(); return plugin.getVersionHistory(params); }
  });

  api.registerTool({
    name: 'revertToVersion',
    description: 'Revert a file to a previous version.',
    parameters: { type: 'object', properties: { filePath: { type: 'string' }, versionNumber: { type: 'integer' } }, required: ['filePath', 'versionNumber'] },
    async execute(_id: string, params: any) { await ensureInit(); return plugin.revertToVersion(params); }
  });

  api.registerTool({
    name: 'setConflictStrategy',
    description: "Set conflict resolution strategy: 'last-write-wins', 'remote-wins', 'local-wins', or 'keep-both'.",
    parameters: { type: 'object', properties: { strategy: { type: 'string', enum: ['last-write-wins', 'remote-wins', 'local-wins', 'keep-both'] } }, required: ['strategy'] },
    execute(_id: string, params: any) { return plugin.setConflictStrategy(params.strategy); }
  });

  api.registerTool({
    name: 'getWatcherStatus',
    description: 'Get status of the automatic file watcher.',
    parameters: { type: 'object', properties: {} },
    execute(_id: string) { return plugin.getWatcherStatus(); }
  });

  api.registerTool({
    name: 'getNextSyncBatch',
    description: 'Get next batch of files to sync (incremental sync).',
    parameters: { type: 'object', properties: {} },
    async execute(_id: string) { await ensureInit(); return plugin.getNextSyncBatch(); }
  });

  api.registerTool({
    name: 'syncBatch',
    description: 'Sync a batch of files in one operation.',
    parameters: { type: 'object', properties: { files: { type: 'array', items: { type: 'string' } } }, required: ['files'] },
    async execute(_id: string, params: any) { await ensureInit(); return plugin.syncBatch(params); }
  });

  api.registerTool({
    name: 'mergeConflict',
    description: 'Intelligently merge conflicting versions of a file.',
    parameters: { type: 'object', properties: { filePath: { type: 'string' }, localContent: { type: 'string' }, remoteContent: { type: 'string' }, baseContent: { type: 'string' } }, required: ['filePath', 'localContent', 'remoteContent'] },
    async execute(_id: string, params: any) { await ensureInit(); return (plugin as any).mergeConflict(params); }
  });

  api.registerTool({
    name: 'getSchedules',
    description: 'Get list of all sync schedules.',
    parameters: { type: 'object', properties: {} },
    execute(_id: string) { return plugin.getSchedules(); }
  });

  api.registerTool({
    name: 'addSchedule',
    description: 'Add a new sync schedule (interval or cron-based).',
    parameters: { type: 'object', properties: { name: { type: 'string' }, type: { type: 'string', enum: ['interval', 'cron'] }, intervalMs: { type: 'integer' }, cronExpression: { type: 'string' } }, required: ['name', 'type'] },
    execute(_id: string, params: any) { return plugin.addSchedule(params); }
  });

  api.registerTool({
    name: 'setScheduleEnabled',
    description: 'Enable or disable a schedule.',
    parameters: { type: 'object', properties: { name: { type: 'string' }, enabled: { type: 'boolean' } }, required: ['name', 'enabled'] },
    execute(_id: string, params: any) { return plugin.setScheduleEnabled(params.name, params.enabled); }
  });

  api.registerTool({
    name: 'triggerSchedule',
    description: 'Manually trigger a scheduled sync immediately.',
    parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    async execute(_id: string, params: any) { await ensureInit(); return plugin.triggerSchedule(params.name); }
  });

  api.registerTool({
    name: 'stopScheduler',
    description: 'Stop all scheduled syncs.',
    parameters: { type: 'object', properties: {} },
    execute(_id: string) { return plugin.stopScheduler(); }
  });

  api.registerTool({
    name: 'getIncrementalSyncStats',
    description: 'Get statistics about incremental sync.',
    parameters: { type: 'object', properties: {} },
    execute(_id: string) { return plugin.getIncrementalSyncStats(); }
  });

  api.registerTool({
    name: 'resetIncrementalSyncTracking',
    description: 'Reset incremental sync tracking (force full sync on next batch).',
    parameters: { type: 'object', properties: {} },
    execute(_id: string) { return plugin.resetIncrementalSyncTracking(); }
  });

  api.registerTool({
    name: 'obsidian_read_file',
    description: 'P3: Lee el contenido de un archivo del vault local de Obsidian. Respeta ACL por scope.',
    parameters: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: "Ruta relativa del archivo en el vault (e.g. '100.Sky/MEMORY.md')" }
      },
      required: ['filePath']
    },
    async execute(_id: string, params: any) { await ensureInit(); return plugin.obsidian_read_file(params); }
  });

  api.registerTool({
    name: 'obsidian_search',
    description: 'P3: Busca texto en todos los archivos .md del vault local. Devuelve archivos y líneas coincidentes.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Texto a buscar' },
        scope: { type: 'string', description: "Filtrar por carpeta raíz (e.g. '100.Sky'). Opcional." },
        maxResults: { type: 'integer', description: 'Número máximo de archivos a devolver (default: 20)' }
      },
      required: ['query']
    },
    async execute(_id: string, params: any) { await ensureInit(); return plugin.obsidian_search(params); }
  });

  api.registerTool({
    name: 'getRemoteWatcherStatus',
    description: 'P3: Get status of the remote CouchDB changes feed (real-time sync from Obsidian to OpenClaw).',
    parameters: { type: 'object', properties: {} },
    execute(_id: string) { return plugin.getRemoteWatcherStatus(); }
  });

  api.registerTool({
    name: 'stopRemoteWatch',
    description: 'P3: Stop the remote CouchDB changes feed.',
    parameters: { type: 'object', properties: {} },
    async execute(_id: string) { return plugin.stopRemoteWatch(); }
  });
}
