// Speicher für 3D-Modelle (Netze), die Generatoren wie das Schichtmodell als Eingabe brauchen. Wie bei Bildern
// liegen die Daten außerhalb von Undo und Dokument-JSON: Die Teile tragen nur die Kennung (Parameter „model“).
// In der Projektdatei stehen die Modelle unter „meshes“, für die automatische Sicherung in IndexedDB.
import { decodeMesh, encodeMesh, Mesh, meshId } from './mesh';

interface Entry {
  data: string;
  mesh: Mesh;
}

const meshes = new Map<string, Entry>();
const listeners = new Set<() => void>();

/** Wird aufgerufen, wenn ein Modell (z. B. aus der Sicherung) nachgeladen wurde */
export function onMeshReady(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Netz eintragen; gleiche Netze ergeben dieselbe Kennung */
export function addMesh(mesh: Mesh): string {
  const data = encodeMesh(mesh);
  const id = meshId(data);
  if (!meshes.has(id)) {
    meshes.set(id, { data, mesh });
    persist(id, data);
  }
  return id;
}

export const getMesh = (id: string): Mesh | null => meshes.get(id)?.mesh ?? null;
export const meshData = (id: string): string | null => meshes.get(id)?.data ?? null;

/** Bekannte Kennung mit Daten (z. B. aus einer Projektdatei) eintragen */
export function registerMesh(id: string, data: string): boolean {
  if (meshes.has(id)) return true;
  try {
    meshes.set(id, { data, mesh: decodeMesh(data) });
  } catch {
    return false;
  }
  persist(id, data);
  return true;
}

// Automatische Sicherung: dieselbe Datenbank wie die Bilder (images.ts), Schlüssel mit Vorsatz „mesh:“
const KEY = (id: string) => `mesh:${id}`;
let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  dbp ??= new Promise((res, rej) => {
    if (typeof indexedDB === 'undefined') return rej(new Error('no indexedDB'));
    const r = indexedDB.open('laserwerk', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('assets');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
function persist(id: string, data: string) {
  db()
    .then((d) => d.transaction('assets', 'readwrite').objectStore('assets').put(data, KEY(id)))
    .catch(() => {
      /* ohne IndexedDB nur für diese Sitzung */
    });
}

/** Fehlende Modelle aus der automatischen Sicherung nachladen */
export function restoreMeshes(ids: Iterable<string>) {
  const missing = [...new Set(ids)].filter((id) => !meshes.has(id));
  if (!missing.length) return;
  db()
    .then((d) => {
      const st = d.transaction('assets', 'readonly').objectStore('assets');
      for (const id of missing) {
        const r = st.get(KEY(id));
        r.onsuccess = () => {
          if (typeof r.result === 'string' && registerMesh(id, r.result)) listeners.forEach((f) => f());
        };
      }
    })
    .catch(() => {
      /* nicht verfügbar */
    });
}

/** Kennung eines eingetragenen Netzes (dasselbe Objekt wie von getMesh) */
export function meshIdOf(mesh: Mesh): string | null {
  for (const [id, e] of meshes) if (e.mesh === mesh) return id;
  return null;
}
