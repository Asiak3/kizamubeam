import './storageMigration';
import './style.css';
import { startupSync } from './sync';

// Einstellungen aus dem Sync-Ordner übernehmen, bevor die App sie liest (ohne Sync-Ordner sofort weiter)
void startupSync()
  .catch(() => {})
  .then(() => import('./app'));
