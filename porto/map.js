/* Porto kaartmodule: zoom, slepen, markers en kaart-rendering. */

const portoMapState = { zoom: 1, x: 0, y: 0, dragging: false, startX: 0, startY: 0, originX: 0, originY: 0 };

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function applyPortoMapTransform() {
  const map = $("#portoOpsMap");
  const layer = map?.querySelector(".porto-map-layer");
  const viewport = map?.querySelector(".porto-map-viewport");
  if (!map || !layer || !viewport) return;
  portoMapState.zoom = clamp(portoMapState.zoom, 1, 4);
  const rect = viewport.getBoundingClientRect();
  const maxX = Math.max(0, ((portoMapState.zoom - 1) * rect.width) / 2);
  const maxY = Math.max(0, ((portoMapState.zoom - 1) * rect.height) / 2);
  portoMapState.x = clamp(portoMapState.x, -maxX, maxX);
  portoMapState.y = clamp(portoMapState.y, -maxY, maxY);
  layer.style.transform = `translate(${portoMapState.x}px, ${portoMapState.y}px) scale(${portoMapState.zoom})`;
  map.style.setProperty("--porto-map-marker-scale", String(1 / portoMapState.zoom));
}

function zoomPortoMap(nextZoom, centerX, centerY) {
  const map = $("#portoOpsMap");
  const viewport = map?.querySelector(".porto-map-viewport");
  if (!viewport) return;
  const rect = viewport.getBoundingClientRect();
  const oldZoom = portoMapState.zoom;
  const newZoom = clamp(nextZoom, 1, 4);
  const cx = Number.isFinite(centerX) ? centerX : rect.width / 2;
  const cy = Number.isFinite(centerY) ? centerY : rect.height / 2;
  const ratio = newZoom / oldZoom;
  portoMapState.x = cx - (cx - portoMapState.x) * ratio;
  portoMapState.y = cy - (cy - portoMapState.y) * ratio;
  portoMapState.zoom = newZoom;
  applyPortoMapTransform();
}

function attachPortoMapEvents(map) {
  const viewport = map.querySelector(".porto-map-viewport");
  if (!viewport || map.dataset.ready === "1") return;
  map.dataset.ready = "1";

  const moveDrag = (event) => {
    if (!portoMapState.dragging) return;
    event.preventDefault();
    portoMapState.x = portoMapState.originX + event.clientX - portoMapState.startX;
    portoMapState.y = portoMapState.originY + event.clientY - portoMapState.startY;
    applyPortoMapTransform();
  };

  const stopDrag = (event) => {
    if (!portoMapState.dragging) return;
    portoMapState.dragging = false;
    viewport.classList.remove("is-dragging");
    map.classList.remove("is-dragging");
    try { map.releasePointerCapture(event.pointerId); } catch (_) {}
    window.removeEventListener("pointermove", moveDrag);
    window.removeEventListener("pointerup", stopDrag);
    window.removeEventListener("pointercancel", stopDrag);
  };

  map.addEventListener("wheel", (event) => {
    if (event.target.closest(".porto-map-controls")) return;
    event.preventDefault();
    const rect = viewport.getBoundingClientRect();
    const factor = event.deltaY < 0 ? 1.16 : 0.86;
    zoomPortoMap(portoMapState.zoom * factor, event.clientX - rect.left, event.clientY - rect.top);
  }, { passive: false });

  map.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target.closest(".porto-map-controls")) return;
    event.preventDefault();
    portoMapState.dragging = true;
    portoMapState.startX = event.clientX;
    portoMapState.startY = event.clientY;
    portoMapState.originX = portoMapState.x;
    portoMapState.originY = portoMapState.y;
    try { map.setPointerCapture(event.pointerId); } catch (_) {}
    viewport.classList.add("is-dragging");
    map.classList.add("is-dragging");
    window.addEventListener("pointermove", moveDrag, { passive: false });
    window.addEventListener("pointerup", stopDrag);
    window.addEventListener("pointercancel", stopDrag);
  });

  map.addEventListener("click", (event) => {
    const button = event.target.closest("[data-map-zoom], [data-map-reset]");
    if (!button) return;
    if (button.dataset.mapReset !== undefined) {
      portoMapState.zoom = 1;
      portoMapState.x = 0;
      portoMapState.y = 0;
      applyPortoMapTransform();
      return;
    }
    const direction = Number(button.dataset.mapZoom || 0);
    zoomPortoMap(portoMapState.zoom + direction * 0.35);
  });
}

function renderOpsMap() {
  const map = $("#portoOpsMap");
  if (!map) return;
  if (!map.querySelector(".porto-map-viewport")) {
    map.innerHTML = `
      <div class="porto-map-controls" aria-label="Kaart bediening">
        <button type="button" data-map-zoom="1" aria-label="Inzoomen">+</button>
        <button type="button" data-map-zoom="-1" aria-label="Uitzoomen">-</button>
        <button type="button" data-map-reset aria-label="Kaart resetten">Reset</button>
      </div>
      <div class="porto-map-viewport">
        <div class="porto-map-layer">
          <img class="porto-map-image" src="assets/gta-v-map.jpg?v=20260510-clean-cover" alt="GTA V kaart" draggable="false" />
          <div class="porto-map-markers"></div>
        </div>
      </div>`;
    attachPortoMapEvents(map);
  }
  const positions = [
    [18, 24], [32, 42], [46, 30], [61, 54], [74, 37], [26, 68], [53, 74], [82, 66], [39, 18], [67, 22]
  ];
  const markerWrap = map.querySelector(".porto-map-markers");
  if (markerWrap) {
    markerWrap.innerHTML = portoActiveUnits.map((unit, index) => {
      const [left, top] = positions[index % positions.length];
      const title = `${unit.vehicleNumber} - ${unit.vehicleName || unit.vehicleType || ""}`;
      return `<button class="porto-map-marker" type="button" style="left:${left}%;top:${top}%" title="${escapeHtml(title)}">${escapeHtml(unit.vehicleNumber)}</button>`;
    }).join("");
  }
  applyPortoMapTransform();
}

window.PortoModules.registerFeature("map", { ready: true });
