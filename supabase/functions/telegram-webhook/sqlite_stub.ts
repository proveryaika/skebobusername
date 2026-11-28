// Supabase Edge Runtime does not provide node:sqlite.
// This shim exists only so mtcute's optional SQLite adapter can be loaded.
// The function always supplies MemoryStorage, so DatabaseSync must never be instantiated.
export class DatabaseSync {
  constructor() {
    throw new Error("SQLite storage is disabled in this Supabase Edge Function; use MemoryStorage.");
  }
}