export const DEFAULT_CCTV_SOURCE_FILE = 'config/cctv_sources.austin.json';
/** Austin Open Data portal endpoint for traffic camera records. */
export const DEFAULT_AUSTIN_ROWS_URL =
  'https://data.austintexas.gov/api/views/b4k4-adkb/rows.json?accessType=DOWNLOAD';
/** Default cap on Austin cameras after distance-based prioritization. */
export const DEFAULT_AUSTIN_MAX_SOURCES = 250;
/** Global cap on total CCTV sources served by the proxy. Six packs (Austin,
 * Caltrans, TfL, Ontario, NZ) can total up to ~1350 at their individual caps,
 * so this sits at the hard ceiling below rather than an arbitrary lower one. */
export const DEFAULT_CCTV_MAX_SOURCES = 1200;
/** Reference point for Austin camera prioritization (Congress & 6th). */
export const AUSTIN_DOWNTOWN = { lat: 30.2672, lon: -97.7431 };
/** Caltrans CCTV: one JSON feed per district, identical schema statewide. */
export const CALTRANS_CCTV_URL = (district) =>
  `https://cwwp2.dot.ca.gov/data/d${district}/cctv/cctvStatusD${String(district).padStart(2, '0')}.json`;
/** Districts fetched by default: SF Bay (4), LA (7), San Diego (11), Sacramento (3). */
export const DEFAULT_CALTRANS_DISTRICTS = '4,7,11,3';
export const DEFAULT_CALTRANS_MAX_SOURCES = 300;
/** Prioritization anchors: downtown cores of the four default metros. */
export const CALTRANS_ANCHORS = [
  { lat: 37.7793, lon: -122.4193 }, // San Francisco
  { lat: 34.0537, lon: -118.2428 }, // Los Angeles
  { lat: 32.7157, lon: -117.1611 }, // San Diego
  { lat: 38.5816, lon: -121.4944 }, // Sacramento
];
/** TfL JamCams: one keyless list endpoint; frames live on a public S3 bucket. */
export const TFL_JAMCAM_URL = 'https://api.tfl.gov.uk/Place/Type/JamCam';
export const TFL_IMAGE_ORIGIN =
  'https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/';
export const DEFAULT_TFL_MAX_SOURCES = 250;
export const LONDON_CENTER = { lat: 51.5074, lon: -0.1278 };
/** Ontario 511 (MTO): one keyless JSON feed covering the whole province; each
 * record can carry several numbered views (angles) at one physical site. */
export const ONTARIO_511_CAMERAS_URL = 'https://511on.ca/api/v2/get/cameras';
export const ONTARIO_511_VIEW_URL = (viewId) =>
  `https://511on.ca/map/Cctv/${encodeURIComponent(viewId)}`;
export const DEFAULT_ONTARIO_MAX_SOURCES = 300;
export const ONTARIO_ANCHOR = { lat: 43.6532, lon: -79.3832 }; // Toronto
/** New Zealand (Waka Kotahi NZTA): one keyless XML feed, nationwide. */
export const NZ_TRAFFIC_CAMERAS_URL =
  'https://trafficnz.info/service/traffic/rest/4/cameras/all';
export const NZ_TRAFFIC_IMAGE_ORIGIN = 'https://trafficnz.info';
export const DEFAULT_NZ_MAX_SOURCES = 250;
export const NZ_ANCHOR = { lat: -36.8485, lon: 174.7633 }; // Auckland
/** Camera CATALOGS change rarely; 15 min keeps multi-megabyte upstream list refetches (Austin rows.json + 4 Caltrans districts + TfL) infrequent. Frames are fetched per-request and are unaffected. */
export const CCTV_SOURCE_CACHE_MS = 15 * 60 * 1000;
/** Per-provider catalog-fetch timeout. Bounds the worst-case refresh so one
 * stalled upstream can't leave getCctvSources (and thus every CCTV route)
 * pending forever — a hung fetch aborts, the loader returns [], and
 * serve-stale/other packs take over. */
export const CCTV_SOURCE_FETCH_TIMEOUT_MS = 30 * 1000;
/** Individual CCTV image fetches must settle before the active 10-second
 * client refresh cadence. A bounded miss can fall through to Street View or
 * the synthetic frame instead of leaving the browser preview pending. */
export const CCTV_FRAME_FETCH_TIMEOUT_MS = 8 * 1000;

/** Maximum buffered snapshot size. */
export const CCTV_FRAME_MAX_BODY_BYTES = 16 * 1024 * 1024;

/** Deadline for upstream response headers; live bodies keep streaming afterward. */
export const CCTV_MEDIA_FETCH_TIMEOUT_MS = 15 * 1000;
/** Declared size ceiling for fixed media responses. */
export const CCTV_MEDIA_MAX_BODY_BYTES = 64 * 1024 * 1024;
