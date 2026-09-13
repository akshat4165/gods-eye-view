import {
  DEFAULT_AUSTIN_ROWS_URL,
  DEFAULT_AUSTIN_MAX_SOURCES,
  AUSTIN_DOWNTOWN,
  CALTRANS_CCTV_URL,
  DEFAULT_CALTRANS_DISTRICTS,
  DEFAULT_CALTRANS_MAX_SOURCES,
  CALTRANS_ANCHORS,
  TFL_JAMCAM_URL,
  TFL_IMAGE_ORIGIN,
  DEFAULT_TFL_MAX_SOURCES,
  LONDON_CENTER,
  ONTARIO_511_CAMERAS_URL,
  ONTARIO_511_VIEW_URL,
  DEFAULT_ONTARIO_MAX_SOURCES,
  ONTARIO_ANCHOR,
  NZ_TRAFFIC_CAMERAS_URL,
  NZ_TRAFFIC_IMAGE_ORIGIN,
  DEFAULT_NZ_MAX_SOURCES,
  NZ_ANCHOR,
  FI_WEATHERCAM_STATIONS_URL,
  FI_WEATHERCAM_IMAGE_URL,
  DEFAULT_FI_MAX_SOURCES,
  FI_ANCHOR,
  CCTV_SOURCE_FETCH_TIMEOUT_MS,
} from './constants.js';
import {
  toFiniteNumber,
  extractAustinCoords,
  extractAustinCameraId,
  extractAustinName,
  extractAustinHeading,
  isLikelyAustinCoordinate,
  fallbackHeadingFromId,
  rowArrayToObject,
  prioritizeSources,
} from './normalize.js';
import { directionToHeading } from '../../../src/data/directionText.js';
/**
 * Fetch and parse Austin traffic camera records from the city Open Data portal.
 *
 * Downloads the Socrata rows.json payload, converts each row to a keyed
 * record, extracts camera ID / coords / heading / name, validates against
 * the Austin bounding box, deduplicates by ID, then distance-prioritizes
 * to stay within CCTV_AUSTIN_MAX_SOURCES.
 *
 * @returns {Promise<Array<object>>} Normalized camera source objects.
 */
export async function loadAustinSourcesFromOpenData() {
  const endpoint = process.env.CCTV_AUSTIN_ROWS_URL || DEFAULT_AUSTIN_ROWS_URL;
  try {
    const resp = await fetch(endpoint, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(CCTV_SOURCE_FETCH_TIMEOUT_MS),
    });
    if (!resp.ok) {
      console.warn('[CCTV] Austin source download failed:', resp.status);
      return [];
    }
    const payload = await resp.json();
    const columns = Array.isArray(payload?.meta?.view?.columns)
      ? payload.meta.view.columns
      : [];
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    if (!columns.length || !rows.length) return [];

    const cameras = [];
    for (const row of rows) {
      if (!Array.isArray(row)) continue;
      const record = rowArrayToObject(row, columns);
      const cameraId = extractAustinCameraId(record);
      if (!cameraId) continue;

      // Only live cameras: the dataset carries DESIRED (planned, not built),
      // REMOVED and VOID rows whose frame URLs never resolve — those cameras
      // would render as permanent Street View / synthetic fallbacks. Tolerate
      // a missing column (keep the row) so a schema change fails open.
      const status = String(record.camera_status || '')
        .trim()
        .toUpperCase();
      if (status && status !== 'TURNED_ON') continue;

      const { lat, lon } = extractAustinCoords(record);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      if (!isLikelyAustinCoordinate(lat, lon)) continue;

      const extractedHeading = extractAustinHeading(record);
      const hasHeading = Number.isFinite(extractedHeading);
      const headingDeg = hasHeading
        ? extractedHeading
        : fallbackHeadingFromId(cameraId);
      cameras.push({
        id: cameraId,
        name: extractAustinName(record, cameraId),
        city: 'Austin',
        cityId: 'austin',
        provider: 'Austin Transportation & Public Works',
        lat,
        lon,
        headingDeg,
        headingConfidence: hasHeading ? 'high' : 'low',
        pitchDeg: hasHeading ? -24 : -18,
        fovDeg: hasHeading ? 56 : 44,
        rangeM: hasHeading ? 210 : 145,
        mountHeightM: hasHeading ? 10 : 8,
        groundElevationM: 150,
        feedType: 'image',
        url: `https://cctv.austinmobility.io/image/${encodeURIComponent(cameraId)}.jpg`,
        snapshotUrl: `https://cctv.austinmobility.io/image/${encodeURIComponent(cameraId)}.jpg`,
        sourceKind: 'austin-open-data',
        license: 'Public city traffic camera frame',
      });
    }

    const unique = Array.from(
      new Map(cameras.map((camera) => [camera.id, camera])).values(),
    );
    const maxRaw = Number(
      process.env.CCTV_AUSTIN_MAX_SOURCES || DEFAULT_AUSTIN_MAX_SOURCES,
    );
    const maxCount = Number.isFinite(maxRaw)
      ? Math.max(8, Math.min(300, Math.floor(maxRaw)))
      : DEFAULT_AUSTIN_MAX_SOURCES;
    const prioritized = prioritizeSources(unique, maxCount, [AUSTIN_DOWNTOWN]);
    if (prioritized.length < unique.length) {
      console.log(
        `[CCTV] Loaded Austin camera sources: ${unique.length} (using nearest ${prioritized.length})`,
      );
    } else {
      console.log('[CCTV] Loaded Austin camera sources:', prioritized.length);
    }
    return prioritized;
  } catch (error) {
    console.warn(
      '[CCTV] Austin source download error:',
      error?.message || error,
    );
    return [];
  }
}

/**
 * Fetch Caltrans CCTV cameras for the configured districts (CCTV_CALTRANS_DISTRICTS,
 * comma-separated 1..12; empty string disables the pack). One official JSON feed per
 * district, identical schema statewide; keyless. Only inService cameras with finite
 * coords and a cwwp2.dot.ca.gov https image URL are kept (the image-URL origin check
 * is defense-in-depth: the proxy only ever fetches catalog URLs, and this pins the
 * catalog to the official host). Districts fetch in parallel and fail independently
 * (Promise.allSettled) — one district outage never darkens the others.
 *
 * @returns {Promise<Array<object>>} Normalized camera source objects.
 */
export async function loadCaltransSourcesFromOpenData() {
  const districtsRaw =
    process.env.CCTV_CALTRANS_DISTRICTS ?? DEFAULT_CALTRANS_DISTRICTS;
  const districts = String(districtsRaw)
    .split(',')
    .map((token) => Number(token.trim()))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 12);
  if (!districts.length) return [];

  const settled = await Promise.allSettled(
    districts.map(async (district) => {
      const resp = await fetch(CALTRANS_CCTV_URL(district), {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(CCTV_SOURCE_FETCH_TIMEOUT_MS),
      });
      if (!resp.ok) throw new Error(`D${district} HTTP ${resp.status}`);
      const payload = await resp.json();
      const rows = Array.isArray(payload?.data) ? payload.data : [];
      return { district, rows };
    }),
  );

  const cameras = [];
  for (const result of settled) {
    if (result.status !== 'fulfilled') {
      console.warn(
        '[CCTV] Caltrans district fetch failed:',
        result.reason?.message || result.reason,
      );
      continue;
    }
    const { district, rows } = result.value;
    for (const row of rows) {
      const cctv = row?.cctv;
      if (!cctv || String(cctv.inService).toLowerCase() !== 'true') continue;
      const loc = cctv.location || {};
      const lat = toFiniteNumber(loc.latitude);
      const lon = toFiniteNumber(loc.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

      const imageUrl = String(cctv.imageData?.static?.currentImageURL || '');
      // Official-host pin (see JSDoc). Also drops records with no still image.
      if (!imageUrl.startsWith('https://cwwp2.dot.ca.gov/')) continue;

      const locationName = String(loc.locationName || '').trim();
      // Leading token of locationName is the stable camera code ("TV102 -- I-580 : …").
      const codeMatch = /^([A-Za-z0-9_-]+)\s*--/.exec(locationName);
      const code = (
        codeMatch ? codeMatch[1] : `x${cameras.length}`
      ).toLowerCase();
      const cameraId = `ca-d${district}-${code}`;

      // loc.direction is a dedicated field ("West", "South") → allow bare words.
      const heading = directionToHeading(loc.direction, true);
      const hasHeading = Number.isFinite(heading);
      const label =
        locationName.replace(/^([A-Za-z0-9_-]+)\s*--\s*/, '') ||
        `Caltrans D${district} ${code}`;
      cameras.push({
        id: cameraId,
        name: loc.nearbyPlace ? `${label} (${loc.nearbyPlace})` : label,
        city: String(loc.nearbyPlace || `Caltrans D${district}`),
        cityId: `ca-d${district}`,
        provider: 'Caltrans',
        lat,
        lon,
        headingDeg: hasHeading ? heading : fallbackHeadingFromId(cameraId),
        headingConfidence: hasHeading ? 'high' : 'low',
        // Same two fabricated pose personalities as Austin (design §1a): these are
        // RAW PRIOR starting points; the client's one-shot ground snap + manual
        // calibration own the truth.
        pitchDeg: hasHeading ? -24 : -18,
        fovDeg: hasHeading ? 56 : 44,
        rangeM: hasHeading ? 210 : 145,
        mountHeightM: hasHeading ? 10 : 8,
        // loc.elevation is reported in FEET (verified: D3 maxes at 7427 ft ≈
        // 2264 m for the Sierra passes — as metres that would top Mt Whitney).
        // Convert to metres and clamp to a sane CA-roads range so an occasional
        // garbage upstream value can't fling a camera kilometres up. Prior only:
        // the client one-shot snap corrects it on 3D-tile stacks — but on a
        // no-tileset stack (keyless OSM) the snap misses and this height freezes,
        // so it must be right-ish on its own.
        groundElevationM: (() => {
          const ft = toFiniteNumber(loc.elevation, NaN);
          return Number.isFinite(ft)
            ? Math.max(-100, Math.min(4000, ft * 0.3048))
            : 150;
        })(),
        feedType: 'image',
        url: imageUrl,
        snapshotUrl: imageUrl,
        sourceKind: 'caltrans-open-data',
        license: 'Public Caltrans highway camera frame',
      });
    }
  }

  const maxRaw = Number(
    process.env.CCTV_CALTRANS_MAX_SOURCES || DEFAULT_CALTRANS_MAX_SOURCES,
  );
  const maxCount = Number.isFinite(maxRaw)
    ? Math.max(8, Math.min(600, Math.floor(maxRaw)))
    : DEFAULT_CALTRANS_MAX_SOURCES;
  const prioritized = prioritizeSources(cameras, maxCount, CALTRANS_ANCHORS);
  console.log(
    `[CCTV] Loaded Caltrans camera sources: ${cameras.length} inService (using nearest ${prioritized.length})`,
  );
  return prioritized;
}

/**
 * Fetch TfL JamCams (London). Keyless: the optional TFL_APP_KEY only raises the
 * list-endpoint rate limit (frames come from TfL's public S3 bucket, which is not
 * rate-limited); the 15-min source cache keeps list hits far below anonymous
 * limits anyway. Only `available === "true"` cameras with finite coords and an
 * image URL on the official bucket are kept. Attribution: "Powered by TfL Open
 * Data" (registered in src/data/dataCredits.js).
 *
 * @returns {Promise<Array<object>>} Normalized camera source objects.
 */
export async function loadTflSourcesFromOpenData() {
  try {
    const appKey = String(process.env.TFL_APP_KEY || '').trim();
    const url = appKey
      ? `${TFL_JAMCAM_URL}?app_key=${encodeURIComponent(appKey)}`
      : TFL_JAMCAM_URL;
    const resp = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(CCTV_SOURCE_FETCH_TIMEOUT_MS),
    });
    if (!resp.ok) {
      console.warn('[CCTV] TfL JamCam download failed:', resp.status);
      return [];
    }
    const places = await resp.json();
    if (!Array.isArray(places)) return [];

    const cameras = [];
    for (const place of places) {
      const props = {};
      for (const p of place?.additionalProperties || []) {
        if (p?.key) props[p.key] = p.value;
      }
      if (String(props.available).toLowerCase() !== 'true') continue;
      const lat = toFiniteNumber(place?.lat);
      const lon = toFiniteNumber(place?.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const imageUrl = String(props.imageUrl || '');
      if (!imageUrl.startsWith(TFL_IMAGE_ORIGIN)) continue; // official-bucket pin

      // "JamCams_00002.00865" → "tfl-00002.00865" (provider-stable id).
      const rawId = String(place?.id || '').replace(/^JamCams_/, '');
      if (!rawId) continue;
      const cameraId = `tfl-${rawId}`;

      cameras.push({
        id: cameraId,
        name: String(place?.commonName || `JamCam ${rawId}`),
        city: 'London',
        cityId: 'london',
        provider: 'Transport for London',
        lat,
        lon,
        // No heading signal at all in JamCam data → id-hash fallback, low
        // confidence personality (same as headingless Austin cameras).
        headingDeg: fallbackHeadingFromId(cameraId),
        headingConfidence: 'low',
        pitchDeg: -18,
        fovDeg: 44,
        rangeM: 145,
        mountHeightM: 8,
        groundElevationM: 15, // Thames-basin prior; one-shot snap corrects.
        feedType: 'image', // stills-first (owner decision); props.videoUrl deliberately unused
        url: imageUrl,
        snapshotUrl: imageUrl,
        sourceKind: 'tfl-open-data',
        license: 'Powered by TfL Open Data',
      });
    }

    const maxRaw = Number(
      process.env.CCTV_TFL_MAX_SOURCES || DEFAULT_TFL_MAX_SOURCES,
    );
    const maxCount = Number.isFinite(maxRaw)
      ? Math.max(8, Math.min(600, Math.floor(maxRaw)))
      : DEFAULT_TFL_MAX_SOURCES;
    const prioritized = prioritizeSources(cameras, maxCount, [LONDON_CENTER]);
    console.log(
      `[CCTV] Loaded TfL JamCam sources: ${cameras.length} available (using nearest ${prioritized.length})`,
    );
    return prioritized;
  } catch (error) {
    console.warn('[CCTV] TfL JamCam download error:', error?.message || error);
    return [];
  }
}

/**
 * Fetch Ontario 511 (MTO RWIS) traffic cameras. Keyless single JSON endpoint
 * covering the whole province — not one city. Each site can carry several
 * numbered `Views` (angles at the same pole); one is picked per site so the
 * catalog stays one-feed-per-physical-camera like the other packs. A view
 * whose Description names a direction ("Looking East") wins over an
 * undirected one ("Looking Down") so more cameras get a real heading instead
 * of the id-hash fallback.
 *
 * @returns {Promise<Array<object>>} Normalized camera source objects.
 */
export async function loadOntarioSourcesFromOpenData() {
  try {
    const resp = await fetch(ONTARIO_511_CAMERAS_URL, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(CCTV_SOURCE_FETCH_TIMEOUT_MS),
    });
    if (!resp.ok) {
      console.warn('[CCTV] Ontario 511 download failed:', resp.status);
      return [];
    }
    const sites = await resp.json();
    if (!Array.isArray(sites)) return [];

    const cameras = [];
    for (const site of sites) {
      const lat = toFiniteNumber(site?.Latitude);
      const lon = toFiniteNumber(site?.Longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const views = Array.isArray(site?.Views) ? site.Views : [];
      const enabled = views.filter(
        (v) => String(v?.Status).toLowerCase() === 'enabled' && v?.Id != null,
      );
      if (!enabled.length) continue;

      // Prefer a view whose description carries a real direction over an
      // undirected one ("Looking Down"); ties keep list order.
      let chosen = null;
      let chosenHeading = NaN;
      for (const view of enabled) {
        const heading = directionToHeading(view?.Description, true);
        if (
          !chosen ||
          (Number.isFinite(heading) && !Number.isFinite(chosenHeading))
        ) {
          chosen = view;
          chosenHeading = heading;
          if (Number.isFinite(heading)) break;
        }
      }
      const cameraId = `on511-${chosen.Id}`;
      const hasHeading = Number.isFinite(chosenHeading);
      const roadway = String(site?.Roadway || '').trim();
      const location = String(site?.Location || '').trim();
      const imageUrl = ONTARIO_511_VIEW_URL(chosen.Id);

      cameras.push({
        id: cameraId,
        name: location || roadway || `Ontario 511 site ${site?.Id}`,
        city: roadway || 'Ontario',
        cityId: 'ontario',
        provider: 'Ontario 511 (Ministry of Transportation)',
        lat,
        lon,
        headingDeg: hasHeading
          ? chosenHeading
          : fallbackHeadingFromId(cameraId),
        headingConfidence: hasHeading ? 'high' : 'low',
        pitchDeg: hasHeading ? -24 : -18,
        fovDeg: hasHeading ? 56 : 44,
        rangeM: hasHeading ? 210 : 145,
        mountHeightM: hasHeading ? 10 : 8,
        groundElevationM: 150,
        feedType: 'image',
        url: imageUrl,
        snapshotUrl: imageUrl,
        sourceKind: 'ontario511-open-data',
        license:
          'Ontario 511 (Ministry of Transportation) — public highway camera frame',
      });
    }

    const unique = Array.from(
      new Map(cameras.map((camera) => [camera.id, camera])).values(),
    );
    const maxRaw = Number(
      process.env.CCTV_ONTARIO_MAX_SOURCES || DEFAULT_ONTARIO_MAX_SOURCES,
    );
    const maxCount = Number.isFinite(maxRaw)
      ? Math.max(8, Math.min(600, Math.floor(maxRaw)))
      : DEFAULT_ONTARIO_MAX_SOURCES;
    const prioritized = prioritizeSources(unique, maxCount, [ONTARIO_ANCHOR]);
    console.log(
      `[CCTV] Loaded Ontario 511 camera sources: ${unique.length} (using nearest ${prioritized.length})`,
    );
    return prioritized;
  } catch (error) {
    console.warn('[CCTV] Ontario 511 download error:', error?.message || error);
    return [];
  }
}

/** One `<camera>…</camera>` record from the NZTA XML feed, as a keyed map of
 * its direct child tag text. Does NOT descend into the nested `<journey>` /
 * `<journeyLeg>` blocks — those carry their own `startLatitude` etc., so a
 * naive whole-block regex on `<latitude>`/`<longitude>` would still be safe
 * (the nested tags are prefixed), but per-tag extraction on the block keeps
 * this loader independent of that coincidence. */
function parseNzCameraBlock(block) {
  const field = (tag) => {
    const m = new RegExp(`<${tag}>([^<]*)<\\/${tag}>`).exec(block);
    return m ? m[1] : '';
  };
  return {
    id: field('id'),
    description: field('description'),
    direction: field('direction'),
    highway: field('highway'),
    imageUrl: field('imageUrl'),
    latitude: field('latitude'),
    longitude: field('longitude'),
    name: field('name'),
    offline: field('offline'),
    region: (() => {
      const regionBlock = /<region>([\s\S]*?)<\/region>/.exec(block)?.[1] || '';
      return /<name>([^<]*)<\/name>/.exec(regionBlock)?.[1] || '';
    })(),
    underMaintenance: field('underMaintenance'),
  };
}

/**
 * Fetch New Zealand (Waka Kotahi NZTA) traffic cameras. Keyless single XML
 * endpoint covering the whole country. No JSON/XML dependency in this
 * project, and the feed's `<camera>` records are flat (no nested tag shares
 * a name with a top-level one — journey/journeyLeg fields are all prefixed,
 * e.g. `startLatitude`) so a small hand-rolled block-and-tag extraction is
 * enough; a malformed or restructured feed degrades to zero cameras rather
 * than throwing.
 *
 * @returns {Promise<Array<object>>} Normalized camera source objects.
 */
export async function loadNzTrafficSourcesFromOpenData() {
  try {
    const resp = await fetch(NZ_TRAFFIC_CAMERAS_URL, {
      headers: { Accept: 'application/xml' },
      signal: AbortSignal.timeout(CCTV_SOURCE_FETCH_TIMEOUT_MS),
    });
    if (!resp.ok) {
      console.warn('[CCTV] NZ traffic camera download failed:', resp.status);
      return [];
    }
    const xml = await resp.text();
    const blocks = xml.match(/<camera>[\s\S]*?<\/camera>/g) || [];

    const cameras = [];
    for (const block of blocks) {
      const rec = parseNzCameraBlock(block);
      if (!rec.id) continue;
      if (String(rec.offline).toLowerCase() === 'true') continue;
      if (String(rec.underMaintenance).toLowerCase() === 'true') continue;
      const lat = toFiniteNumber(rec.latitude);
      const lon = toFiniteNumber(rec.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      if (!rec.imageUrl.startsWith('/')) continue; // official-relative-path pin
      const imageUrl = `${NZ_TRAFFIC_IMAGE_ORIGIN}${rec.imageUrl}`;

      const cameraId = `nz-${rec.id}`;
      const heading = directionToHeading(rec.direction, true);
      const hasHeading = Number.isFinite(heading);
      const label =
        rec.name.trim() ||
        rec.description.trim() ||
        `${rec.highway || 'NZ'} camera ${rec.id}`;

      cameras.push({
        id: cameraId,
        name: label,
        city: rec.region || rec.highway || 'New Zealand',
        cityId: 'nz',
        provider: 'Waka Kotahi NZ Transport Agency',
        lat,
        lon,
        headingDeg: hasHeading ? heading : fallbackHeadingFromId(cameraId),
        headingConfidence: hasHeading ? 'high' : 'low',
        pitchDeg: hasHeading ? -24 : -18,
        fovDeg: hasHeading ? 56 : 44,
        rangeM: hasHeading ? 210 : 145,
        mountHeightM: hasHeading ? 10 : 8,
        groundElevationM: 150,
        feedType: 'image',
        url: imageUrl,
        snapshotUrl: imageUrl,
        sourceKind: 'nztraffic-open-data',
        license:
          'Waka Kotahi NZ Transport Agency — public highway camera frame',
      });
    }

    const unique = Array.from(
      new Map(cameras.map((camera) => [camera.id, camera])).values(),
    );
    const maxRaw = Number(
      process.env.CCTV_NZ_MAX_SOURCES || DEFAULT_NZ_MAX_SOURCES,
    );
    const maxCount = Number.isFinite(maxRaw)
      ? Math.max(8, Math.min(600, Math.floor(maxRaw)))
      : DEFAULT_NZ_MAX_SOURCES;
    const prioritized = prioritizeSources(unique, maxCount, [NZ_ANCHOR]);
    console.log(
      `[CCTV] Loaded NZ traffic camera sources: ${unique.length} (using nearest ${prioritized.length})`,
    );
    return prioritized;
  } catch (error) {
    console.warn(
      '[CCTV] NZ traffic camera download error:',
      error?.message || error,
    );
    return [];
  }
}

/**
 * Fetch and normalize Finland (Fintraffic/Digitraffic) weather camera
 * sources: one keyless nationwide JSON feed. Each station carries one or
 * more directional presets with a documented direct `imageUrl`; the first
 * in-collection preset is used as that station's camera pin (mirrors the
 * "one pin per site" pattern used for Ontario's multi-view sites).
 * @returns {Promise<Array<object>>}
 */
export async function loadFinlandSourcesFromOpenData() {
  try {
    const resp = await fetch(FI_WEATHERCAM_STATIONS_URL, {
      headers: { Accept: 'application/json', 'Accept-Encoding': 'gzip' },
      signal: AbortSignal.timeout(CCTV_SOURCE_FETCH_TIMEOUT_MS),
    });
    if (!resp.ok) {
      console.warn('[CCTV] Finland weathercam download failed:', resp.status);
      return [];
    }
    const data = await resp.json();
    const stations = Array.isArray(data?.features) ? data.features : [];

    const cameras = [];
    for (const station of stations) {
      const [lon, lat] = Array.isArray(station?.geometry?.coordinates)
        ? station.geometry.coordinates
        : [];
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const props = station?.properties || {};
      if (String(props.collectionStatus).toUpperCase() !== 'GATHERING') {
        continue;
      }
      const presets = Array.isArray(props.presets) ? props.presets : [];
      const chosen = presets.find((p) => p?.inCollection && p?.id);
      if (!chosen) continue;

      // The bulk feed carries no direction text per preset (only a per-station
      // detail fetch does — see FI_WEATHERCAM_IMAGE_URL), so headings here are
      // always the low-confidence hash fallback, same as an undirected camera
      // on any other pack.
      const cameraId = `fi-${chosen.id}`;
      const imageUrl = FI_WEATHERCAM_IMAGE_URL(chosen.id);
      const name =
        props.names?.en || props.name || `Finland camera ${props.id}`;

      cameras.push({
        id: cameraId,
        name,
        city: props.municipality || 'Finland',
        cityId: 'finland',
        provider: 'Fintraffic (Digitraffic)',
        lat,
        lon,
        headingDeg: fallbackHeadingFromId(cameraId),
        headingConfidence: 'low',
        pitchDeg: -18,
        fovDeg: 44,
        rangeM: 145,
        mountHeightM: 8,
        groundElevationM: 150,
        feedType: 'image',
        url: imageUrl,
        snapshotUrl: imageUrl,
        sourceKind: 'fintraffic-open-data',
        license: 'Fintraffic (Digitraffic) — CC BY 4.0 weather camera frame',
      });
    }

    const unique = Array.from(
      new Map(cameras.map((camera) => [camera.id, camera])).values(),
    );
    const maxRaw = Number(
      process.env.CCTV_FI_MAX_SOURCES || DEFAULT_FI_MAX_SOURCES,
    );
    const maxCount = Number.isFinite(maxRaw)
      ? Math.max(8, Math.min(600, Math.floor(maxRaw)))
      : DEFAULT_FI_MAX_SOURCES;
    const prioritized = prioritizeSources(unique, maxCount, [FI_ANCHOR]);
    console.log(
      `[CCTV] Loaded Finland weathercam sources: ${unique.length} (using nearest ${prioritized.length})`,
    );
    return prioritized;
  } catch (error) {
    console.warn(
      '[CCTV] Finland weathercam download error:',
      error?.message || error,
    );
    return [];
  }
}
