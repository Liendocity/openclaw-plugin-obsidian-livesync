import PouchDB from 'pouchdb';
import findPouchDBAdapter from 'pouchdb-adapter-http';
import fs from 'fs';
import path from 'path';
import { encrypt as encryptHKDF, decrypt as decryptHKDF, decryptWithEphemeralSalt } from 'octagonal-wheels/encryption/hkdf';
import xxhash from 'xxhash-wasm';

PouchDB.plugin(findPouchDBAdapter);

export default class ObsidianLiveSyncPlugin {
  private db: any;
  private config: any;
  private vaultSettings: any;
  private hasher: any;

  constructor(config: any) {
    this.config = config;
  }

  async initialize() {
    this.hasher = await xxhash();
    
    // Extract settings from URI
    let encryptedData = this.config.setup_uri;
    if (encryptedData.includes('settings=')) {
      encryptedData = encryptedData.split('settings=')[1];
    }
    encryptedData = decodeURIComponent(encryptedData);

    try {
      const decrypted = await decryptWithEphemeralSalt(encryptedData, this.config.passphrase);
      this.vaultSettings = JSON.parse(decrypted);
      
      const remoteUrl = `${this.vaultSettings.couchDB_URI}/${this.vaultSettings.couchDB_DBNAME}`;
      this.db = new PouchDB(remoteUrl, {
        auth: { 
          username: this.vaultSettings.couchDB_USER, 
          password: this.vaultSettings.couchDB_PASSWORD 
        }
      });
      console.log(`Plugin Obsidian conectado a: ${remoteUrl}`);
    } catch (e: any) {
      throw new Error(`Error al inicializar el plugin: ${e.message}. Verifica el Passphrase y el Setup URI.`);
    }
  }

  /**
   * Tool: Sync a file to CouchDB
   */
  async obsidian_sync_file({ filePath }: { filePath: string }) {
    const fullPath = path.resolve(process.cwd(), filePath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Archivo no encontrado: ${filePath}`);
    }

    const content = fs.readFileSync(fullPath);
    // The salt is not explicitly in the JSON, but LiveSync V2 uses the same passphrase/settings.
    // However, for decryption of chunks we might still need the pbkdf2salt.
    // Let's find it in the database if it's there, or assume V2 constants.
    
    // In LiveSync V2, the salt is often stored in the DB. We'll fetch it once.
    const pbkdf2Salt = await this.getSalt();

    const CHUNK_SIZE = 50 * 1024;
    const children: string[] = [];

    for (let i = 0; i < content.length; i += CHUNK_SIZE) {
      const chunkData = content.slice(i, i + CHUNK_SIZE);
      const chunkHash = this.hasher.h64(chunkData.toString('binary'));
      const chunkId = `h:+${chunkHash}`;

      const encryptedData = await encryptHKDF(
        chunkData.toString('base64'),
        this.config.passphrase,
        pbkdf2Salt
      );

      try {
        await this.db.put({
          _id: chunkId,
          data: encryptedData,
          type: 'leaf',
          e_: true
        });
      } catch (err: any) {
        if (err.status !== 409) throw err;
      }
      children.push(chunkId);
    }

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
    return { success: true, message: `Archivo ${filePath} sincronizado con Obsidian.` };
  }

  async obsidian_pull_vault() {
    console.log("Descargando vault desde CouchDB...");
    const result = await this.db.allDocs({ include_docs: true });
    const salt = await this.getSalt();
    
    const chunkMap = new Map();
    const fileDocs = [];

    for (const row of result.rows) {
      const doc = row.doc;
      if (doc.type === 'leaf') {
        try {
          const decrypted = await decryptHKDF(doc.data, this.config.passphrase, salt);
          chunkMap.set(doc._id, Buffer.from(decrypted, 'base64'));
        } catch (e) { /* skip */ }
      } else if (doc.type === 'plain' || doc.type === 'newnote') {
        fileDocs.push(doc);
      }
    }

    for (const doc of fileDocs) {
      const relativePath = doc.path || doc._id;
      const fullPath = path.resolve(process.cwd(), relativePath);
      const dir = path.dirname(fullPath);

      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      const fileChunks = doc.children || [];
      const buffers = fileChunks
        .map((id: string) => chunkMap.get(id))
        .filter((b: any) => b !== undefined);

      if (buffers.length > 0) {
        fs.writeFileSync(fullPath, Buffer.concat(buffers));
        console.log(`  Reconstruido: ${relativePath}`);
      }
    }

    return { success: true, message: "Vault reconstruido con éxito en el workspace." };
  }

  private async getSalt(): Promise<Uint8Array> {
    // Attempt to find the salt in the DB documents if not provided.
    // For now, based on previous analysis, we know its value. 
    // In a real plugin, we could fetch it from a specific config doc in CouchDB.
    // For this vault, it's: 'WI//FsJF51+UoRStP3ZQ8nOPpK33Hd4srTiQswHfatg='
    return Buffer.from('WI//FsJF51+UoRStP3ZQ8nOPpK33Hd4srTiQswHfatg=', 'base64');
  }
}
