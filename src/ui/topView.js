// TOP VIEW — a flat, north-up map camera like Google/Apple Maps.
//
// Turning it on flies the camera straight down (nadir) over whatever is at the
// center of the screen, keeping roughly the same viewing distance, and disables
// tilt/free-look so dragging pans and scrolling zooms like a 2D map. The scene
// stays in 3D mode (Cesium's SCENE2D can't draw Photorealistic 3D Tiles), so
// every layer keeps working.
//
// While it's on, a camera flight that leaves the view oblique (a search result,
// a location preset) is eased back to nadir once it settles. Cockpit, CCTV
// calibration and tracked entities own the camera and are left alone.

import * as Cesium from 'cesium';

const NADIR = -Cesium.Math.PI_OVER_TWO;
const OBLIQUE_PITCH = Cesium.Math.toRadians(-45);
const RECOVER_TOLERANCE = Cesium.Math.toRadians(4);
const MIN_RANGE_M = 250;
const MAX_RANGE_M = 25_000_000;

/** World point under the screen center, or under the camera as a fallback. */
function centerTarget(viewer) {
  const { scene, camera } = viewer;
  const canvas = scene.canvas;
  const center = new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2);
  let target;
  try {
    if (scene.pickPositionSupported) target = scene.pickPosition(center);
  } catch {
    target = undefined;
  }
  if (!target || !Cesium.defined(target)) target = camera.pickEllipsoid(center, scene.globe.ellipsoid);
  if (target) {
    const carto = Cesium.Cartographic.fromCartesian(target);
    // pickPosition can land on the sky dome / far plane at extreme ranges.
    if (carto && Math.abs(carto.height) < 50_000) {
      const range = Cesium.Cartesian3.distance(camera.positionWC, target);
      return { carto, range };
    }
  }
  const cameraCarto = camera.positionCartographic;
  return {
    carto: new Cesium.Cartographic(cameraCarto.longitude, cameraCarto.latitude, 0),
    range: cameraCarto.height,
  };
}

/**
 * @param {object} options
 * @param {Cesium.Viewer} options.viewer
 * @param {HTMLButtonElement|null} options.button
 * @param {{ active: boolean, stop(): void }} [options.orbitController]
 * @param {(message: string) => void} [options.notify]
 * @returns {{ toggle(): void, setEnabled(on: boolean): void, isEnabled(): boolean, destroy(): void }}
 */
export function createTopView({ viewer, button, orbitController = null, notify = null }) {
  const controller = viewer.scene.screenSpaceCameraController;
  let enabled = false;
  let flying = false;
  let saved = null;

  const syncButton = () => {
    if (!button) return;
    button.setAttribute('aria-pressed', String(enabled));
    const label = enabled ? 'Exit top view (T)' : 'Top view — flat north-up map (T)';
    button.title = label;
    button.setAttribute('aria-label', label);
  };

  const cameraIsOwnedElsewhere = () =>
    !controller.enableInputs || !!viewer.trackedEntity || !!orbitController?.active;

  const flyTo = (pitch, { duration = 1.2 } = {}) => {
    const { carto, range } = centerTarget(viewer);
    const clamped = Cesium.Math.clamp(range, MIN_RANGE_M, MAX_RANGE_M);
    flying = true;
    const done = () => {
      flying = false;
    };
    if (pitch === NADIR) {
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, carto.height + clamped),
        orientation: { heading: 0, pitch: NADIR, roll: 0 },
        duration,
        easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
        complete: done,
        cancel: done,
      });
    } else {
      const target = Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, carto.height);
      viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(target, 0), {
        offset: new Cesium.HeadingPitchRange(viewer.camera.heading, pitch, clamped),
        duration,
        easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
        complete: done,
        cancel: done,
      });
    }
    viewer.scene.requestRender();
  };

  const onMoveEnd = () => {
    if (!enabled || flying || cameraIsOwnedElsewhere()) return;
    if (Math.abs(viewer.camera.pitch - NADIR) > RECOVER_TOLERANCE) flyTo(NADIR, { duration: 0.6 });
  };

  const setEnabled = (on) => {
    on = !!on;
    if (on === enabled) return;
    // A running camera flight (fly-in, location preset) disables inputs until it
    // ends; ours replaces it anyway, so cancel it before checking ownership.
    if (on) viewer.camera.cancelFlight();
    if (on && cameraIsOwnedElsewhere()) {
      if (orbitController?.active) orbitController.stop();
      else {
        notify?.('Top view is unavailable in cockpit or while following a target');
        return;
      }
    }
    enabled = on;
    if (on) {
      saved = { tilt: controller.enableTilt, look: controller.enableLook };
      controller.enableTilt = false;
      controller.enableLook = false;
      flyTo(NADIR);
      notify?.('TOP VIEW · drag to pan, scroll to zoom');
    } else {
      controller.enableTilt = saved?.tilt ?? true;
      controller.enableLook = saved?.look ?? true;
      saved = null;
      if (!cameraIsOwnedElsewhere()) flyTo(OBLIQUE_PITCH);
    }
    syncButton();
  };

  const toggle = () => setEnabled(!enabled);

  const onKeyDown = (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
    if (event.key.toLowerCase() !== 't') return;
    if (event.target?.closest?.('select, input, textarea, [contenteditable="true"]')) return;
    toggle();
  };

  const removeMoveEnd = viewer.camera.moveEnd.addEventListener(onMoveEnd);
  button?.addEventListener('click', toggle);
  document.addEventListener('keydown', onKeyDown);
  syncButton();

  return {
    toggle,
    setEnabled,
    isEnabled: () => enabled,
    destroy() {
      removeMoveEnd();
      button?.removeEventListener('click', toggle);
      document.removeEventListener('keydown', onKeyDown);
      if (enabled && !viewer.isDestroyed()) {
        controller.enableTilt = saved?.tilt ?? true;
        controller.enableLook = saved?.look ?? true;
      }
    },
  };
}
