import PouchDB from 'pouchdb';
import findPouchDBAdapter from 'pouchdb-adapter-http';
import fs from 'fs';
import path from 'path';
import { encrypt as encryptHKDF } from 'octagonal-wheels/encryption/hkdf';
import xxhash from 'xxhash-wasm';

PouchDB.plugin(findPouchDBAdapter);

export default class ObsidianLiveSyncPlugin {
  private db: any;
  private config: any;
  private hasher: any;

  constructor(config: any) {
    this.config = config;
    this.db = new PouchDB(config.couchdb_url, {
      auth: { username: config.username, password: config.password }
    });
  }

  async initialize() {
    this.hasher = await xxhash();
  }

  /**
   * Tool: Sync a file to CouchDB
   */
  async obsidian_sync_file({ filePath }: { filePath: string }) {
    const fullPath = path.resolve(process.cwd(), filePath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const content = fs.readFileSync(fullPath);
    const salt = Buffer.from(this.config.salt, 'base64');
    const CHUNK_SIZE = 50 * 1024;
    const children: string[] = [];

    for (let i = 0; i < content.length; i += CHUNK_SIZE) {
      const chunkData = content.slice(i, i + CHUNK_SIZE);
      const chunkHash = this.hasher.h64(chunkData.toString('binary'));
      const chunkId = `h:+${chunkHash}`;

      // Encrypt chunk
      const encryptedData = await encryptHKDF(
        chunkData.toString('base64'),
        this.config.passphrase,
        salt
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
    return { success: true, message: `File ${filePath} synced to Obsidian vault.` };
  }
}
