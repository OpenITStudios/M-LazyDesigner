import { randomBytes } from "node:crypto";
import { lstat, mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Filesystem-only L0 storage. A single newest pending payload coalesces writes
 * during slow disk I/O. It never blocks or changes the Gateway response.
 */
const MAX_SNAPSHOT_BYTES = 128 * 1024;
const MAX_SESSION_FILES = 16;
const OWNED_FILE = /^session-[0-9]{13}-[a-f0-9]{16}\.json$/;

export class ProjectObservationSnapshotStore {
  private pendingPayload: string | null = null;
  private writing = false;
  private writeTail: Promise<void> = Promise.resolve();
  private retentionChecked = false;
  private failures = 0;

  constructor(
    private readonly directory: string,
    private readonly fileName: string
  ) {
    if (!OWNED_FILE.test(fileName)) {
      throw new Error("Invalid project observation snapshot filename.");
    }
  }

  get persistFailures(): number {
    return this.failures;
  }

  /** No unbounded write queue, raw tool payload or synchronous disk I/O. */
  submit(payload: string): void {
    if (Buffer.byteLength(payload, "utf8") > MAX_SNAPSHOT_BYTES) {
      this.failures++;
      return;
    }
    this.pendingPayload = payload;
    if (this.writing) return;
    this.writing = true;
    this.writeTail = this.drain();
  }

  private async drain(): Promise<void> {
    const dir = this.directory;
    const file = join(dir, this.fileName);
    try {
      while (this.pendingPayload !== null) {
        const payload = this.pendingPayload;
        this.pendingPayload = null;
        const temporary = file + "." + randomBytes(6).toString("hex") + ".tmp";
        let created = false;
        try {
          await mkdir(dir, { recursive: true });
          // Exclusive creation refuses any existing temp path or symlink.
          await writeFile(temporary, payload, { encoding: "utf8", flag: "wx" });
          created = true;
          await rename(temporary, file);
          created = false;
          if (!this.retentionChecked) {
            this.retentionChecked = true;
            const names = (await readdir(dir)).filter(name => OWNED_FILE.test(name)).sort();
            const others = names.filter(name => name !== this.fileName);
            for (const name of others.slice(0, Math.max(0, names.length - MAX_SESSION_FILES))) {
              const stale = join(dir, name);
              try {
                const meta = await lstat(stale);
                if (meta.isFile()) await rm(stale);
              } catch { /* Cache pruning never affects authoring. */ }
            }
          }
        } catch {
          this.failures++;
        } finally {
          if (created) {
            try { await rm(temporary, { force: true }); }
            catch { /* Best-effort temp cleanup only. */ }
          }
        }
      }
    } finally {
      this.writing = false;
    }
  }

  async flush(): Promise<void> {
    await this.writeTail;
  }
}
