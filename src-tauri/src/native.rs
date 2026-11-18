//! Rechenkern (kizamubeam-core) für die Oberfläche: Bildverarbeitung, Rasterzeilen der Bilder und G-Code.
//! Bilddaten und fertiger G-Code bleiben hier, damit große Datenmengen nicht mehrfach durch die Oberfläche müssen.

use kizamubeam_core::{gcode, raster, ruida};
use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::State;

/// So viele verarbeitete Bilder bleiben im Zwischenspeicher (Anzeige und Laserjob nutzen dasselbe Ergebnis)
const PROCESSED_KEEP: usize = 8;
/// So viele vorbereitete G-Codes bleiben abrufbar
const GCODE_KEEP: usize = 8;

#[derive(Default)]
pub struct Native {
    /// Graustufen der Bilder in voller Auflösung (dekodiert von der Webansicht)
    assets: Mutex<HashMap<String, Arc<raster::Gray>>>,
    processed: Mutex<VecDeque<(String, Arc<Vec<u8>>)>>,
    gcode: Mutex<VecDeque<(u32, Arc<Vec<String>>)>>,
    ruida: Mutex<VecDeque<(u32, Arc<Vec<u8>>)>>,
    next_id: Mutex<u32>,
}

impl Native {
    fn gray(&self, id: &str) -> Result<Arc<raster::Gray>, String> {
        self.assets.lock().unwrap().get(id).cloned().ok_or_else(|| format!("Bild {id} unbekannt"))
    }

    /// Verarbeitetes Bild aus dem Zwischenspeicher oder neu rechnen
    fn processed(&self, id: &str, cols: usize, rows: usize, adj: &raster::Adjust, l: &raster::ImageLayer) -> Result<Arc<Vec<u8>>, String> {
        let key = format!("{id}|{cols}|{rows}|{adj:?}|{l:?}");
        if let Some((_, v)) = self.processed.lock().unwrap().iter().find(|(k, _)| *k == key) {
            return Ok(v.clone());
        }
        let src = self.gray(id)?;
        let v = Arc::new(raster::process(&src, adj, l, cols.max(1), rows.max(1)));
        let mut c = self.processed.lock().unwrap();
        c.push_back((key, v.clone()));
        while c.len() > PROCESSED_KEEP {
            c.pop_front();
        }
        Ok(v)
    }

    pub fn gcode(&self, id: u32) -> Result<Arc<Vec<String>>, String> {
        self.gcode
            .lock()
            .unwrap()
            .iter()
            .find(|(k, _)| *k == id)
            .map(|(_, v)| v.clone())
            .ok_or_else(|| "G-Code nicht mehr vorhanden, bitte den Job erneut starten.".into())
    }

    pub fn ruida_opt(&self, id: u32) -> Option<Arc<Vec<u8>>> {
        self.ruida
            .lock()
            .unwrap()
            .iter()
            .find(|(k, _)| *k == id)
            .map(|(_, v)| v.clone())
    }

    pub fn ruida(&self, id: u32) -> Result<Arc<Vec<u8>>, String> {
        self.ruida_opt(id)
            .ok_or_else(|| "Ruida-Daten (.rd) nicht mehr vorhanden, bitte den Job erneut starten.".into())
    }
}

fn raw_body(req: &Request) -> Result<Vec<u8>, String> {
    match req.body() {
        InvokeBody::Raw(b) => Ok(b.clone()),
        _ => Err("Binärdaten erwartet".into()),
    }
}

/// Rechenarbeit außerhalb des Ereignis-Threads ausführen
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

/// Graustufen eines Bildes (f32 je Punkt) unter der Asset-ID der Oberfläche ablegen.
/// Kopfzeilen: `x-asset` = ID, `x-size` = Breite x Höhe in Punkten.
#[tauri::command]
pub fn image_register(req: Request<'_>, state: State<'_, Arc<Native>>) -> Result<(), String> {
    let header = |k: &str| req.headers().get(k).and_then(|v| v.to_str().ok()).ok_or_else(|| format!("Kopfzeile {k} fehlt"));
    let id = header("x-asset")?.to_string();
    let (w, h) = header("x-size")?.split_once('x').ok_or("Ungültige Bildgröße")?;
    let (w, h) = (w.parse().map_err(|_| "Ungültige Bildgröße")?, h.parse().map_err(|_| "Ungültige Bildgröße")?);
    let gray = raster::gray_from_bytes(w, h, &raw_body(&req)?)?;
    let mut assets = state.assets.lock().unwrap();
    assets.entry(id).or_insert_with(|| Arc::new(gray));
    Ok(())
}

/// Verarbeitetes Bild: je Ausgabepunkt ein Byte (0 = brennen … 255 = aus)
#[tauri::command]
pub async fn image_process(
    state: State<'_, Arc<Native>>,
    id: String,
    cols: usize,
    rows: usize,
    adjust: raster::Adjust,
    layer: raster::ImageLayer,
) -> Result<Response, String> {
    let st = state.inner().clone();
    let v = blocking(move || st.processed(&id, cols, rows, &adjust, &layer)).await?;
    Ok(Response::new(v.as_ref().clone()))
}

/// Rasterzeilen eines Bildes für den Laserjob (Aufbau siehe raster::pack_lines)
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn image_scan(
    state: State<'_, Arc<Native>>,
    id: String,
    cols: usize,
    rows: usize,
    adjust: raster::Adjust,
    layer: raster::ImageLayer,
    w: f64,
    h: f64,
    m: raster::Mat,
    im: raster::Mat,
) -> Result<Response, String> {
    let st = state.inner().clone();
    blocking(move || {
        let v = st.processed(&id, cols, rows, &adjust, &layer)?;
        let lines = raster::scan_lines(&v, cols.max(1), rows.max(1), w, h, &m, &im, &layer);
        Ok(Response::new(raster::pack_lines(&lines)))
    })
    .await
}

/// G-Code aus der Bewegungsliste schreiben und behalten. Antwort: u32 ID, u32 Zeilenzahl, dann f64 Zeit je Zeile.
#[tauri::command]
pub async fn gcode_prepare(req: Request<'_>, state: State<'_, Arc<Native>>) -> Result<Response, String> {
    let body = raw_body(&req)?;
    let st = state.inner().clone();
    blocking(move || {
        let (lines, times) = gcode::write_packed(&body)?;
        let id = {
            let mut n = st.next_id.lock().unwrap();
            *n = n.wrapping_add(1);
            *n
        };
        let mut out = Vec::with_capacity(8 + times.len() * 8);
        out.extend_from_slice(&id.to_le_bytes());
        out.extend_from_slice(&(lines.len() as u32).to_le_bytes());
        for t in &times {
            out.extend_from_slice(&t.to_le_bytes());
        }
        let mut g = st.gcode.lock().unwrap();
        g.push_back((id, Arc::new(lines)));
        while g.len() > GCODE_KEEP {
            g.pop_front();
        }
        Ok(Response::new(out))
    })
    .await
}

/// Vorbereiteten G-Code über einen nativen Speichern-Dialog sichern. Gibt den Pfad zurück oder None bei Abbruch.
#[tauri::command]
pub async fn gcode_save(
    app: tauri::AppHandle,
    state: State<'_, Arc<Native>>,
    id: u32,
    default_name: String,
    filter_name: String,
) -> Result<Option<String>, String> {
    use std::io::Write;
    use tauri_plugin_dialog::DialogExt;
    let lines = state.gcode(id)?;
    let picked = app.dialog().file().set_file_name(&default_name).add_filter(&filter_name, &["gcode"]).blocking_save_file();
    let Some(path) = picked else { return Ok(None) };
    let path = path.into_path().map_err(|e| e.to_string())?;
    let file = std::fs::File::create(&path).map_err(|e| e.to_string())?;
    let mut w = std::io::BufWriter::new(file);
    for l in lines.iter() {
        w.write_all(l.as_bytes()).and_then(|_| w.write_all(b"\n")).map_err(|e| e.to_string())?;
    }
    w.flush().map_err(|e| e.to_string())?;
    Ok(Some(path.display().to_string()))
}

/// Ruida-Binärdaten (.rd) aus der Bewegungsliste schreiben und behalten. Antwort: u32 ID, u32 Paketanzahl.
#[tauri::command]
pub async fn ruida_prepare(req: Request<'_>, state: State<'_, Arc<Native>>) -> Result<Response, String> {
    let body = raw_body(&req)?;
    let st = state.inner().clone();
    blocking(move || {
        let bytes = ruida::write_packed(&body)?;
        let m = ruida::magic_for_file(&bytes);
        let plain = ruida::unswizzle(&bytes, m);
        let pkt_count = ruida::packetize(&plain, 1000, m).len().max(1) as u32;
        let id = {
            let mut n = st.next_id.lock().unwrap();
            *n = n.wrapping_add(1);
            *n
        };
        let mut out = Vec::with_capacity(8);
        out.extend_from_slice(&id.to_le_bytes());
        out.extend_from_slice(&pkt_count.to_le_bytes());
        let mut r = st.ruida.lock().unwrap();
        r.push_back((id, Arc::new(bytes)));
        while r.len() > GCODE_KEEP {
            r.pop_front();
        }
        Ok(Response::new(out))
    })
    .await
}

/// Vorbereitete Ruida-Datei (.rd) über einen nativen Speichern-Dialog sichern.
#[tauri::command]
pub async fn ruida_save(
    app: tauri::AppHandle,
    state: State<'_, Arc<Native>>,
    id: u32,
    default_name: String,
    filter_name: String,
) -> Result<Option<String>, String> {
    use std::io::Write;
    use tauri_plugin_dialog::DialogExt;
    let bytes = state.ruida(id)?;
    let picked = app
        .dialog()
        .file()
        .set_file_name(&default_name)
        .add_filter(&filter_name, &["rd"])
        .blocking_save_file();
    let Some(path) = picked else { return Ok(None) };
    let path = path.into_path().map_err(|e| e.to_string())?;
    let mut file = std::fs::File::create(&path).map_err(|e| e.to_string())?;
    file.write_all(&bytes).map_err(|e| e.to_string())?;
    file.flush().map_err(|e| e.to_string())?;
    Ok(Some(path.display().to_string()))
}

