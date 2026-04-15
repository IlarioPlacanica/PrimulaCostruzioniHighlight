Cesium.Ion.defaultAccessToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiIzMDMzYWFiYy03NmQ2LTQ1Y2ItOTIxMC00YTlhNWJiOTczYTEiLCJpZCI6MjI5OTIwLCJpYXQiOjE3MzUxNDI5ODN9.5JsxkFNj9aTyDXASAq5If6K6oQmBRtw4-xzKA0-ksec";

const viewerSection = document.getElementById("viewer");

const viewer = new Cesium.Viewer("cesiumContainer", {
    timeline: false,
    animation: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    fullscreenButton: true,
    fullscreenElement: viewerSection,
    infoBox: false,
    selectionIndicator: false,
    globe: false
});

viewer.scene.skyBox.show = false;
viewer.scene.sun.show = false;
viewer.scene.moon.show = false;
viewer.scene.backgroundColor = Cesium.Color.fromCssColorString("#bcdcff");

viewer.clock.currentTime = Cesium.JulianDate.fromDate(
    new Date("2025-06-21T12:00:00Z")
);

let googleTileset;

try {
    googleTileset = await Cesium.createGooglePhotorealistic3DTileset();

    googleTileset.customShader = new Cesium.CustomShader({
        mode: Cesium.CustomShaderMode.MODIFY_MATERIAL,
        lightingModel: Cesium.LightingModel.UNLIT,
        fragmentShaderText: `
            void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
                material.diffuse = clamp(material.diffuse * 1.5, 0.0, 1.0);
            }
        `
    });

    viewer.scene.primitives.add(googleTileset);
} catch (error) {
    console.error("Errore nel caricamento del tileset Google:", error);
}

// =========================
// CAMERA
// =========================

const controller = viewer.scene.screenSpaceCameraController;
const canvas = viewer.scene.canvas;
const homeViewButton = document.getElementById("homeViewButton");
const enterViewerButton = document.getElementById("enterViewerButton");
const partnershipFiltersList = document.getElementById("partnershipFiltersList");

canvas.style.touchAction = "none";

let isOrbitMode = false;
let currentOrbitTarget = null;
let isViewerUnlocked = false;

let orbitHeading = Cesium.Math.toRadians(55);
let orbitPitch = Cesium.Math.toRadians(-35);
const defaultOrbitRange = 150;
let orbitRange = defaultOrbitRange;

const minPitch = Cesium.Math.toRadians(-80);
const maxPitch = Cesium.Math.toRadians(-10);
const minRange = 120;
const maxRange = 900;

const initialCameraView = {
    destination: Cesium.Cartesian3.fromDegrees(
        7.683707690243468,
        45.04866692889891,
        1000
    ),
    orientation: {
        heading: Cesium.Math.toRadians(-10),
        pitch: Cesium.Math.toRadians(-20),
        roll: 0
    }
};

function enableOrbitControls() {
    controller.enableInputs = false;
    controller.enableTranslate = false;
    controller.enableZoom = false;
    controller.enableTilt = false;
    controller.enableRotate = false;
    controller.enableLook = false;
}

function enableCesiumControls() {
    controller.enableInputs = true;
    controller.enableTranslate = true;
    controller.enableZoom = true;
    controller.enableTilt = true;
    controller.enableRotate = true;
    controller.enableLook = true;
}

function disableViewerControls() {
    controller.enableInputs = false;
    controller.enableTranslate = false;
    controller.enableZoom = false;
    controller.enableTilt = false;
    controller.enableRotate = false;
    controller.enableLook = false;
}

function syncViewerControls() {
    if (!isViewerUnlocked) {
        disableViewerControls();
        return;
    }

    if (isOrbitMode) {
        enableOrbitControls();
    } else {
        enableCesiumControls();
    }
}

function updateOrbitCamera() {
    if (!isOrbitMode || !currentOrbitTarget) return;

    viewer.camera.lookAt(
        currentOrbitTarget,
        new Cesium.HeadingPitchRange(orbitHeading, orbitPitch, orbitRange)
    );
}

function enterFreeCameraMode() {
    isOrbitMode = false;
    currentOrbitTarget = null;

    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    controller.enableInputs = false;

    closeInfoPanel();
    setSelectedLotOverlay(null);
    restoreSelectedPolygonVisibility();

    viewer.camera.flyTo({
        destination: initialCameraView.destination,
        orientation: initialCameraView.orientation,
        duration: 2.8,
        easingFunction: Cesium.EasingFunction.QUADRATIC_IN_OUT,
        complete: () => {
            syncViewerControls();

            if (homeViewButton) {
                homeViewButton.classList.add("hidden");
            }

            setActivePolygonMenuButton("");
        },
        cancel: () => {
            syncViewerControls();

            if (homeViewButton) {
                homeViewButton.classList.add("hidden");
            }

            setActivePolygonMenuButton("");
        }
    });
}

function focusPolygonAndLockView(entity) {
    const hierarchy = getEntityHierarchy(entity);
    const positions = hierarchy?.positions || [];
    if (!positions.length) return;

    const boundingSphere = Cesium.BoundingSphere.fromPoints(positions);
    currentOrbitTarget = boundingSphere.center;
    orbitRange = defaultOrbitRange;

    isOrbitMode = false;
    controller.enableInputs = false;

    viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);

    viewer.camera.flyToBoundingSphere(boundingSphere, {
        duration: 2.8,
        offset: new Cesium.HeadingPitchRange(
            orbitHeading,
            orbitPitch,
            orbitRange
        ),
        complete: () => {
            isOrbitMode = true;
            syncViewerControls();
            updateOrbitCamera();

            if (homeViewButton) {
                homeViewButton.classList.remove("hidden");
            }
        },
        cancel: () => {
            isOrbitMode = false;
            syncViewerControls();

            if (homeViewButton) {
                homeViewButton.classList.add("hidden");
            }
        }
    });
}

viewer.camera.setView(initialCameraView);
disableViewerControls();

if (homeViewButton) {
    homeViewButton.classList.add("hidden");
    homeViewButton.addEventListener("click", enterFreeCameraMode);
}

let isPointerDown = false;
let startX = 0;
let startY = 0;

const activePointers = new Map();
let isPinching = false;
let lastPinchDistance = 0;

function getPointerDistance() {
    if (activePointers.size < 2) return 0;
    const points = Array.from(activePointers.values());
    const dx = points[0].x - points[1].x;
    const dy = points[0].y - points[1].y;
    return Math.hypot(dx, dy);
}

function beginOrbitDrag(x, y) {
    isPointerDown = true;
    startX = x;
    startY = y;
}

function syncSinglePointerAfterGesture() {
    if (activePointers.size === 1 && !isPinching) {
        const remainingPointer = Array.from(activePointers.values())[0];
        beginOrbitDrag(remainingPointer.x, remainingPointer.y);
        return;
    }

    isPointerDown = false;
}

canvas.addEventListener("pointerdown", (event) => {
    if (!isOrbitMode) return;

    const isPrimaryMouseButton = event.pointerType !== "touch" ? event.button === 0 : true;
    if (!isPrimaryMouseButton) return;

    activePointers.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY
    });

    if (activePointers.size === 2) {
        isPinching = true;
        isPointerDown = false;
        lastPinchDistance = getPointerDistance();
    } else if (activePointers.size === 1) {
        beginOrbitDrag(event.clientX, event.clientY);
    }

    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
});

canvas.addEventListener("pointermove", (event) => {
    if (!isOrbitMode) return;

    if (activePointers.has(event.pointerId)) {
        activePointers.set(event.pointerId, {
            x: event.clientX,
            y: event.clientY
        });
    }

    if (isPinching && activePointers.size >= 2) {
        const currentDistance = getPointerDistance();
        const pinchDelta = currentDistance - lastPinchDistance;

        if (Math.abs(pinchDelta) > 2) {
            const pinchSensitivity = 1.5;
            orbitRange -= pinchDelta * pinchSensitivity;
            orbitRange = Cesium.Math.clamp(orbitRange, minRange, maxRange);
            updateOrbitCamera();
            lastPinchDistance = currentDistance;
        }

        event.preventDefault();
        return;
    }

    if (!isPointerDown || activePointers.size !== 1) return;

    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;

    startX = event.clientX;
    startY = event.clientY;

    const sensitivity = 0.003;

    orbitHeading += deltaX * sensitivity;
    orbitPitch -= deltaY * sensitivity;
    orbitPitch = Cesium.Math.clamp(orbitPitch, minPitch, maxPitch);

    updateOrbitCamera();
    event.preventDefault();
});

canvas.addEventListener("pointerup", (event) => {
    if (!isOrbitMode) return;

    activePointers.delete(event.pointerId);

    if (activePointers.size < 2) {
        isPinching = false;
        lastPinchDistance = 0;
    }

    syncSinglePointerAfterGesture();
    event.preventDefault();
});

canvas.addEventListener("pointercancel", (event) => {
    if (!isOrbitMode) return;

    activePointers.delete(event.pointerId);

    if (activePointers.size < 2) {
        isPinching = false;
        lastPinchDistance = 0;
    }

    syncSinglePointerAfterGesture();
});

canvas.addEventListener("lostpointercapture", (event) => {
    if (!isOrbitMode) return;

    activePointers.delete(event.pointerId);

    if (activePointers.size < 2) {
        isPinching = false;
        lastPinchDistance = 0;
    }

    syncSinglePointerAfterGesture();
});

canvas.addEventListener("wheel", (event) => {
    if (!isViewerUnlocked) {
        event.preventDefault();
        event.stopPropagation();
    }
}, { passive: false });

canvas.addEventListener("pointerdown", (event) => {
    if (!isViewerUnlocked) {
        event.preventDefault();
        event.stopPropagation();
    }
}, true);

canvas.addEventListener("wheel", (event) => {
    if (!isOrbitMode) return;

    event.preventDefault();

    const zoomStep = 25;

    if (event.deltaY > 0) {
        orbitRange += zoomStep;
    } else {
        orbitRange -= zoomStep;
    }

    orbitRange = Cesium.Math.clamp(orbitRange, minRange, maxRange);
    updateOrbitCamera();
}, { passive: false });


if (enterViewerButton) {
    enterViewerButton.addEventListener("click", () => {
        isViewerUnlocked = true;
        setTimeout(syncViewerControls, 500);
    });
}

// =========================
// DEBUG PUNTI / PREVIEW
// =========================

const lottoPoints = [];
let lottoPointEntities = [];
let lottoPolygonEntity = null;
let lottoPolylineEntity = null;

function addPointMarker(position) {
    const point = viewer.entities.add({
        position,
        point: {
            pixelSize: 10,
            color: Cesium.Color.YELLOW,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2
        }
    });

    lottoPointEntities.push(point);
}

function createLivePreview() {
    if (!lottoPolylineEntity) {
        lottoPolylineEntity = viewer.entities.add({
            polyline: {
                positions: new Cesium.CallbackProperty(() => lottoPoints, false),
                width: 3,
                material: Cesium.Color.YELLOW
            }
        });
    }

    if (!lottoPolygonEntity) {
        lottoPolygonEntity = viewer.entities.add({
            polygon: {
                hierarchy: new Cesium.CallbackProperty(() => {
                    if (lottoPoints.length < 3) return null;
                    return new Cesium.PolygonHierarchy(lottoPoints);
                }, false),
                material: Cesium.Color.RED.withAlpha(0.35),
                outline: false
            }
        });
    }
}

// =========================
// UI / INFO PANEL
// =========================

const infoPanel = document.getElementById("infoPanel");
const closePanel = document.getElementById("closePanel");
const infoEyebrow = document.getElementById("infoEyebrow");
const lotTitle = document.getElementById("lotTitle");
const infoPanelBody = document.getElementById("infoPanelBody");
const operationsMenu = document.getElementById("operationsMenu");
const operationsMenuToggle = document.getElementById("operationsMenuToggle");
const operationsMenuPanel = document.getElementById("operationsMenuPanel");
const polygonButtonsList = document.getElementById("polygonButtonsList");

function getProp(entity, key) {
    if (!entity?.properties?.[key]) return "-";
    const value = entity.properties[key];
    return value.getValue ? value.getValue(Cesium.JulianDate.now()) : value;
}

function formatValue(value) {
    return value === undefined || value === null || value === "" ? "-" : value;
}

function closeInfoPanel() {
    infoPanel.classList.add("hidden");
}

function openInfoPanel() {
    infoPanel.classList.remove("hidden");
}

if (closePanel) {
    closePanel.addEventListener("click", closeInfoPanel);
}

function getAllLotti() {
    return viewer.entities.values.filter(entity =>
        entity.polygon && entity.properties
    );
}

function normalizePartnershipValue(value) {
    const normalized = formatValue(value).trim();
    return normalized || "-";
}

function getAllPartnershipValues() {
    const uniqueValues = new Set();

    getAllLotti().forEach((entity) => {
        const value = normalizePartnershipValue(getProp(entity, "investimentiPartnership"));

        if (value === "-") return;

        uniqueValues.add(value);
    });

    return Array.from(uniqueValues).sort((a, b) => a.localeCompare(b, "it"));
}

let activePartnershipFilter = "ALL";

function isEntityMatchingActiveFilter(entity) {
    if (activePartnershipFilter === "ALL") return true;
    const value = normalizePartnershipValue(getProp(entity, "investimentiPartnership"));
    return value === activePartnershipFilter;
}

function getPolygonGroupsForMenu() {
    const groups = new Map();

    getAllLotti().forEach((entity) => {
        if (!entity?.name || !entity.polygon || entity.show === false) return;

        if (entity.name === "Aree Comuni" && entity.id !== "lotto Aree_Comuni.1") {
            return;
        }

        if (!groups.has(entity.name)) {
            groups.set(entity.name, []);
        }

        groups.get(entity.name).push(entity);
    });

    return Array.from(groups.entries())
        .map(([name, entities]) => ({
            name,
            entities,
            primaryEntity: entities[0]
        }))
        .sort((a, b) => a.name.localeCompare(b.name, "it"));
}

function setOperationsMenuOpen(isOpen) {
    if (!operationsMenu || !operationsMenuToggle || !operationsMenuPanel) return;

    operationsMenu.classList.toggle("is-open", isOpen);
    operationsMenuPanel.classList.toggle("hidden", !isOpen);
    operationsMenuToggle.setAttribute("aria-expanded", String(isOpen));
}

function toggleOperationsMenu() {
    const isOpen = operationsMenu?.classList.contains("is-open");
    setOperationsMenuOpen(!isOpen);
}

function setActivePolygonMenuButton(entityName) {
    if (!polygonButtonsList) return;

    const buttons = polygonButtonsList.querySelectorAll(".polygon-list-button");
    buttons.forEach((button) => {
        const isActive = button.dataset.entityName === entityName;
        button.classList.toggle("is-active", isActive);
    });
}

function renderSingleLotInfo(entity) {
    infoEyebrow.textContent = "";
    lotTitle.textContent = entity.name || "Lotto";

    const immagine = formatValue(getProp(entity, "immagine"));
    const investimentiPartnership = formatValue(getProp(entity, "investimentiPartnership"));
    const surface = formatValue(getProp(entity, "surface"));
    const apartments = formatValue(getProp(entity, "apartments"));
    const trackRecord = formatValue(getProp(entity, "trackRecord"));
    const descrizione = formatValue(getProp(entity, "descrizione"));

    infoPanelBody.innerHTML = `
        <div class="info-grid">
            ${immagine !== "-" ? `
                <div class="info-image-wrap">
                    <img class="info-image" src="${immagine}" alt="${entity.name || "Lotto"}" />
                </div>
            ` : ""}

            <div class="info-row">
                <span>Investimenti & Partnership</span>
                <strong>${investimentiPartnership}</strong>
            </div>

            <div class="info-row">
                <span>Surface</span>
                <strong>${surface}</strong>
            </div>

            <div class="info-row">
                <span>Apartments</span>
                <strong>${apartments}</strong>
            </div>

            <div class="info-row">
                <span>Track Record</span>
                <strong>${trackRecord}</strong>
            </div>

            <div class="info-text-block">
                <span>Descrizione</span>
                <p>${descrizione}</p>
            </div>
        </div>
    `;

    openInfoPanel();
}

function handlePolygonSelection(entity, options = {}) {
    if (!entity || entity.show === false) return;

    restoreSelectedPolygonVisibility();
    blinkPolygon(entity);
    hideSelectedPolygon(entity);

    renderSingleLotInfo(entity);
    focusPolygonAndLockView(entity);
    setSelectedLotOverlay(entity);
    setActivePolygonMenuButton(entity.name || "");

    if (options.closeMenuAfterSelect !== false) {
        setOperationsMenuOpen(false);
    }
}

function buildPolygonButtonsMenu() {
    if (!polygonButtonsList) return;

    const groups = getPolygonGroupsForMenu();
    polygonButtonsList.innerHTML = "";

    groups.forEach(({ name, primaryEntity }) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "polygon-list-button";
        button.textContent = name;
        button.dataset.entityName = name;

        button.addEventListener("click", () => {
            handlePolygonSelection(primaryEntity, { closeMenuAfterSelect: true });
        });

        polygonButtonsList.appendChild(button);
    });
}

function bindOperationsMenuEvents() {
    if (!operationsMenuToggle) return;

    operationsMenuToggle.addEventListener("click", () => {
        toggleOperationsMenu();
    });

    document.addEventListener("click", (event) => {
        if (!operationsMenu) return;
        if (operationsMenu.contains(event.target)) return;
        setOperationsMenuOpen(false);
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            setOperationsMenuOpen(false);
        }
    });
}

function setActivePartnershipFilterButton() {
    if (!partnershipFiltersList) return;

    const buttons = partnershipFiltersList.querySelectorAll(".partnership-filter-button");
    buttons.forEach((button) => {
        const isActive = button.dataset.filterValue === activePartnershipFilter;
        button.classList.toggle("is-active", isActive);
    });
}

function setSelectedLotOverlay(entity) {
    activeSelectedLotName = entity?.name || "";
    refreshSelectedLotOverlayVisibility();
}

function applyPartnershipFilter() {
    getAllLotti().forEach((entity) => {
        entity.show = isEntityMatchingActiveFilter(entity);
    });

    refreshLotMarkersVisibility();
    refreshSelectedLotOverlayVisibility();
    buildPolygonButtonsMenu();

    const selectedEntityStillVisible = getAllLotti().find((entity) => {
        return entity.name === activeSelectedLotName && entity.show !== false;
    });

    if (!selectedEntityStillVisible) {
        restoreSelectedPolygonVisibility();
        setSelectedLotOverlay(null);
        closeInfoPanel();
        setActivePolygonMenuButton("");
    }
}

function setPartnershipFilter(value) {
    activePartnershipFilter = value;
    setActivePartnershipFilterButton();
    applyPartnershipFilter();
}

function buildPartnershipFiltersPanel() {
    if (!partnershipFiltersList) return;

    const values = getAllPartnershipValues();
    const filters = ["ALL", ...values];

    partnershipFiltersList.innerHTML = "";

    filters.forEach((value) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "partnership-filter-button";
        button.dataset.filterValue = value;
        button.textContent = value === "ALL" ? "Tutti" : value;

        button.addEventListener("click", () => {
            setPartnershipFilter(value);
        });

        partnershipFiltersList.appendChild(button);
    });

    setActivePartnershipFilterButton();
}

window.closeInfoPanel = closeInfoPanel;

// =========================
// BLINK POLIGONO
// =========================

function blinkPolygon(entity) {
    if (!entity || !entity.polygon) return;
    if (entity._isBlinking) return;

    entity._isBlinking = true;

    const polygon = entity.polygon;
    const now = Cesium.JulianDate.now();

    let baseColor = Cesium.Color.RED.withAlpha(0.28);

    if (polygon.material instanceof Cesium.ColorMaterialProperty) {
        const c = polygon.material.color?.getValue(now);
        if (c) baseColor = Cesium.Color.clone(c);
    } else if (polygon.material && polygon.material.red !== undefined) {
        baseColor = Cesium.Color.clone(polygon.material);
    }

    const highlightColor = new Cesium.Color(
        Cesium.Math.lerp(baseColor.red, 1.0, 0.20),
        Cesium.Math.lerp(baseColor.green, 1.0, 0.20),
        Cesium.Math.lerp(baseColor.blue, 1.0, 0.28),
        baseColor.alpha
    );

    const originalMaterial = polygon.material;
    const highlightMaterial = new Cesium.ColorMaterialProperty(highlightColor);

    polygon.material = highlightMaterial;

    setTimeout(() => {
        polygon.material = originalMaterial;
        entity._isBlinking = false;
    }, 420);
}

function setPolygonOpacity(entity, alpha) {
    if (!entity?.polygon) return;

    const polygon = entity.polygon;
    const now = Cesium.JulianDate.now();

    let baseColor = Cesium.Color.BLUE.withAlpha(0.2);

    if (polygon.material instanceof Cesium.ColorMaterialProperty) {
        const currentColor = polygon.material.color?.getValue(now);
        if (currentColor) {
            baseColor = Cesium.Color.clone(currentColor);
        }
    } else if (polygon.material && polygon.material.red !== undefined) {
        baseColor = Cesium.Color.clone(polygon.material);
    }

    polygon.material = new Cesium.ColorMaterialProperty(
        new Cesium.Color(
            baseColor.red,
            baseColor.green,
            baseColor.blue,
            alpha
        )
    );
}

function restoreSelectedPolygonVisibility() {
    if (!activeSelectedPolygonEntity) return;

    setPolygonOpacity(activeSelectedPolygonEntity, 0.2);
    activeSelectedPolygonEntity = null;
}

function hideSelectedPolygon(entity) {
    if (!entity?.polygon) return;

    if (activeSelectedPolygonEntity && activeSelectedPolygonEntity !== entity) {
        setPolygonOpacity(activeSelectedPolygonEntity, 0.2);
    }

    activeSelectedPolygonEntity = entity;
    setPolygonOpacity(entity, 0.0);
}

// =========================
// MARKER LOTTI / OVERLAY SELEZIONE
// =========================

const lotMarkerEntities = [];
const lotSelectedOverlayEntities = [];
let activeSelectedLotName = "";
let activeSelectedPolygonEntity = null;

function getEntityHierarchy(entity) {
    const hierarchyProperty = entity?.polygon?.hierarchy;
    if (!hierarchyProperty) return null;

    return hierarchyProperty.getValue
        ? hierarchyProperty.getValue(Cesium.JulianDate.now())
        : hierarchyProperty;
}

function getLotTopMetrics(entities) {
    const positions = entities.flatMap(entity => getEntityHierarchy(entity)?.positions || []);

    if (!positions.length) {
        return {
            longitude: 0,
            latitude: 0,
            topHeight: 0
        };
    }

    let lonSum = 0;
    let latSum = 0;
    let maxHeight = 0;

    positions.forEach((position) => {
        const cartographic = Cesium.Cartographic.fromCartesian(position);
        lonSum += cartographic.longitude;
        latSum += cartographic.latitude;
        maxHeight = Math.max(maxHeight, cartographic.height || 0);
    });

    const averageLon = lonSum / positions.length;
    const averageLat = latSum / positions.length;

    const extrudedHeights = entities.map(entity => {
        const extrudedHeightProperty = entity.polygon?.extrudedHeight;
        return extrudedHeightProperty?.getValue
            ? extrudedHeightProperty.getValue(Cesium.JulianDate.now())
            : extrudedHeightProperty;
    });

    const topHeight = Math.max(
        maxHeight,
        ...extrudedHeights.filter(value => typeof value === "number"),
        0
    );

    return {
        longitude: averageLon,
        latitude: averageLat,
        topHeight
    };
}

function getDiamondSvg(fillColor = "#6fd3ff") {
    return `
      <svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
        <defs>
          <filter id="g" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" result="b"/>
            <feMerge>
              <feMergeNode in="b"/>
              <feMergeNode in="SourceGraphic"/>
            </feMerge>
          </filter>
        </defs>
        <g filter="url(#g)">
          <polygon
            points="48,10 68,44 48,78 28,44"
            fill="${fillColor}"
            fill-opacity="0.95"
            stroke="rgba(255,255,255,0.95)"
            stroke-width="3"
            stroke-linejoin="round"
          />
          <polygon
            points="48,22 60,44 48,66 36,44"
            fill="rgba(255,255,255,0.22)"
          />
        </g>
      </svg>
    `;
}

function buildLotMarkerEntities(name, entities) {
    const primaryEntity = entities[0];
    const metrics = getLotTopMetrics(entities);

    const baseHeight = metrics.topHeight + 0.2;
    const markerHeight = metrics.topHeight + 42;

    const markerBasePosition = Cesium.Cartesian3.fromRadians(
        metrics.longitude,
        metrics.latitude,
        baseHeight
    );

    const markerPosition = Cesium.Cartesian3.fromRadians(
        metrics.longitude,
        metrics.latitude,
        markerHeight
    );

    const diamondSvg = getDiamondSvg("#6fd3ff");

    const baseGlow = viewer.entities.add({
        id: `markerGlow_${primaryEntity.id}`,
        name: `${name}_marker_glow`,
        position: markerBasePosition,
        properties: {
            isLotMarker: true,
            linkedEntityId: primaryEntity.id
        },
        ellipse: {
            semiMajorAxis: 7,
            semiMinorAxis: 7,
            height: baseHeight,
            material: Cesium.Color.fromCssColorString("#6fd3ff").withAlpha(0.14),
            outline: false
        }
    });

    const baseRing = viewer.entities.add({
        id: `markerRing_${primaryEntity.id}`,
        name: `${name}_marker_ring`,
        position: markerBasePosition,
        properties: {
            isLotMarker: true,
            linkedEntityId: primaryEntity.id
        },
        ellipse: {
            semiMajorAxis: 10,
            semiMinorAxis: 10,
            height: baseHeight + 0.05,
            material: Cesium.Color.WHITE.withAlpha(0.01),
            outline: true,
            outlineColor: Cesium.Color.fromCssColorString("#6fd3ff").withAlpha(0.45),
            outlineWidth: 1
        }
    });

    const diamond = viewer.entities.add({
        id: `markerDiamond_${primaryEntity.id}`,
        name: `${name}_marker_diamond`,
        position: markerPosition,
        properties: {
            isLotMarker: true,
            linkedEntityId: primaryEntity.id
        },
        billboard: {
            image: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(diamondSvg)}`,
            scale: 0.60,
            verticalOrigin: Cesium.VerticalOrigin.CENTER,
            horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            scaleByDistance: new Cesium.NearFarScalar(180.0, 1.0, 2200.0, 0.75)
        }
    });

    [baseGlow, baseRing, diamond].forEach((markerPart) => {
        markerPart._linkedEntities = entities;
        markerPart._lotName = name;
    });

    return { baseGlow, baseRing, diamond };
}

function buildSelectedLotOverlayEntity(name, entities) {
    const primaryEntity = entities[0];
    const iconPath = getProp(primaryEntity, "icona") || "assets/icons/default-marker.png";
    const metrics = getLotTopMetrics(entities);

    const iconPosition = Cesium.Cartesian3.fromRadians(
        metrics.longitude,
        metrics.latitude,
        metrics.topHeight + 18
    );

    const iconEntity = viewer.entities.add({
        id: `selectedIcon_${primaryEntity.id}`,
        name: `${name}_selected_icon`,
        position: iconPosition,
        show: false,
        properties: {
            isLotSelectedOverlay: true,
            linkedEntityId: primaryEntity.id
        },
        billboard: {
            image: iconPath,
            scale: 0.15,
            horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            pixelOffset: new Cesium.Cartesian2(0, 0),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            scaleByDistance: new Cesium.NearFarScalar(180.0, 1.3, 2200.0, 0.60)
        }
    });

    iconEntity._linkedEntities = entities;
    iconEntity._lotName = name;

    return { iconEntity };
}

function applySelectedOverlayResponsiveStyles() {
    // nessuna label da aggiornare
}

function addMarkersToAllLotti() {
    const groups = new Map();

    getAllLotti().forEach((entity) => {
        if (!entity?.name || !entity.polygon) return;

        if (entity.name === "Aree Comuni" && entity.id !== "lotto Aree_Comuni.1") {
            return;
        }

        if (!groups.has(entity.name)) {
            groups.set(entity.name, []);
        }

        groups.get(entity.name).push(entity);
    });

    groups.forEach((entities, name) => {
        const markerGroup = buildLotMarkerEntities(name, entities);
        lotMarkerEntities.push(markerGroup);

        const overlayGroup = buildSelectedLotOverlayEntity(name, entities);
        lotSelectedOverlayEntities.push(overlayGroup);
    });

    refreshLotMarkersVisibility();
    refreshSelectedLotOverlayVisibility();
}

function refreshLotMarkersVisibility() {
    lotMarkerEntities.forEach((markerGroup) => {
        const linkedEntities = markerGroup.diamond?._linkedEntities || [];
        const shouldShow = linkedEntities.some(entity => entity.show !== false);

        markerGroup.baseGlow.show = shouldShow;
        markerGroup.baseRing.show = shouldShow;
        markerGroup.diamond.show = shouldShow;
    });
}

function refreshSelectedLotOverlayVisibility() {
    lotSelectedOverlayEntities.forEach((overlayGroup) => {
        const linkedEntities = overlayGroup.iconEntity?._linkedEntities || [];
        const shouldShow =
            !!activeSelectedLotName &&
            overlayGroup.iconEntity?._lotName === activeSelectedLotName &&
            linkedEntities.some(entity => entity.show !== false);

        overlayGroup.iconEntity.show = shouldShow;
    });
}

// =========================
// LOTTI
// =========================

viewer.entities.add({
    id: "Pacioli",
    name: "Palazzo Pacioli",
    polygon: {
        hierarchy: Cesium.Cartesian3.fromDegreesArrayHeights([
            7.680553715724734, 45.066194515764714, 315,
            7.680024641169531, 45.06637472941949, 315,
            7.680419284415251, 45.06693423075481, 315,
            7.680980767577986, 45.06673813242232, 315
        ]),
        material: new Cesium.ColorMaterialProperty(
            Cesium.Color.BLUE.withAlpha(0.2)
        ),
        perPositionHeight: true,
        extrudedHeight: 285,
        outline: false
    },
    properties: {
        immagine: "assets/img/pacioli.jpeg",
        investimentiPartnership: "Sponsor, private entity",
        surface: " 16,500 m²",
        apartments: " 95",
        trackRecord: " 25.000.000 €",
        icona: "assets/icons/pacioli.png",
        descrizione: `Previously the historical headoffice of INPS (National Health Service), Palazzo
                        Pacioli will be reborn as a luxury residential building in the heart of Turin. The
                        building features a total surface of 16,500 square meters and will host 92
                        apartments as well as 146 garages and cellars. The ground floor will house
                        luxury shops, high profile activities and services. The building rehabilitation
                        will also entail an urban regeneration intervention - the last stretch of via G.
                        Amendola will be pedestrianized while providing the main entrance to the large
                        monumental hall of the palace. The intervention, which will include various
                        condominium amenities, is bound to be one of the most significant heritage
                        architectural recovery works in the historical centre of Turin.`
    }
});

viewer.entities.add({
    id: "Velo",
    name: "Casa Vélo",
    polygon: {
        hierarchy: Cesium.Cartesian3.fromDegreesArrayHeights([
            7.6813577618989966, 45.06824347861252, 315,
            7.680809660560081, 45.06845195572183, 315,
            7.681078766649869, 45.068738979560706, 315,
            7.681569142587408, 45.06857365903585, 315
        ]),
        material: new Cesium.ColorMaterialProperty(
            Cesium.Color.BLUE.withAlpha(0.2)
        ),
        perPositionHeight: true,
        extrudedHeight: 285,
        outline: false
    },
    properties: {
        immagine: "assets/img/velo.jpg",
        investimentiPartnership: "Prop trading, Local co-investor",
        surface: " 10,000 m²",
        apartments: " 94",
        trackRecord: " 35.000.000 €",
        icona: "assets/icons/velo.png",
        descrizione: `Harmonious fusion between an eighteenth-century palace
                        and an contemporary building, in the heart of Turin.
                        10,000 m² distributed in 85 customizable apartments
                        with beautiful interior views, 27 garages, a pleasant and
                        relaxing green space and a prestigious inner pyramidal
                        glass-domed courtyard.`
    }
});

viewer.entities.add({
    id: "Alfieri",
    name: "Angoli",
    polygon: {
        hierarchy: Cesium.Cartesian3.fromDegreesArrayHeights([
            7.677751532298875, 45.068316182918814, 300,
            7.6783465742329575, 45.068115905344634, 300,
            7.678580187544821, 45.06842887263733, 300,
            7.67797094993596, 45.06864785502038, 300
        ]),
        material: new Cesium.ColorMaterialProperty(
            Cesium.Color.BLUE.withAlpha(0.2)
        ),
        perPositionHeight: true,
        extrudedHeight: 285,
        outline: false
    },
    properties: {
        immagine: "assets/img/alfieri.png",
        investimentiPartnership: "-",
        surface: " - m²",
        apartments: " -",
        trackRecord: " - €",
        icona: "assets/icons/angoli.png",
        descrizione: `-.`
    }
});

viewer.entities.add({
    id: "Molassi",
    name: "Corte Molassi",
    polygon: {
        hierarchy: Cesium.Cartesian3.fromDegreesArrayHeights([
            7.687116541255778, 45.077871719988856, 315,
            7.686471933328111, 45.07805649220268, 315,
            7.686154922005348, 45.07753015447171, 315,
            7.6868119647134625, 45.07735059613495, 315
        ]),
        material: new Cesium.ColorMaterialProperty(
            Cesium.Color.BLUE.withAlpha(0.2)
        ),
        perPositionHeight: true,
        extrudedHeight: 280,
        outline: false
    },
    properties: {
        immagine: "assets/img/molassi.jpg",
        investimentiPartnership: "-",
        surface: " - m²",
        apartments: " -",
        trackRecord: " - €",
        icona: "assets/icons/molassi.png",
        descrizione: `-.`
    }
});

viewer.entities.add({
    id: "Contemporaneo",
    name: "Palazzo Contemporaneo",
    polygon: {
        hierarchy: Cesium.Cartesian3.fromDegreesArrayHeights([
            7.66993201562417, 45.06291125676272, 320,
            7.669576858989491, 45.06228205194891, 320,
            7.669941770397155, 45.06214593962472, 320,
            7.670047996531381, 45.06229323162203, 320,
            7.670244263912098, 45.06235440165116, 320,
            7.67043470573154, 45.062291220558706, 320,
            7.670652820451309, 45.062616873449926, 320
        ]),
        material: new Cesium.ColorMaterialProperty(
            Cesium.Color.BLUE.withAlpha(0.2)
        ),
        perPositionHeight: true,
        extrudedHeight: 280,
        outline: false
    },
    properties: {
        immagine: "assets/img/contemporaneo.jpg",
        investimentiPartnership: "Prop trading",
        surface: " 10,000 m²",
        apartments: " 95",
        trackRecord: " 27.980.000 €",
        icona: "assets/icons/contemporaneo.png",
        descrizione: `Palazzo Contemporaneo will be a new building of approximately
                        10,000 square meters with 10 floors above ground, in the historical
                        residential neighbourhood of Crocetta. The building will be completely
                        demolished and rebuilt experimenting and applying new construction
                        techniques to create a unique product, both from a commercial and
                        executive standpoint. The high standards of sustainability coupled with
                        the historical character of the area, will transform it into an icon of the
                        Turin skyline.`
    }
});

viewer.entities.add({
    id: "Dune",
    name: "Palazzo Dune",
    polygon: {
        hierarchy: Cesium.Cartesian3.fromDegreesArrayHeights([
            7.681566823732004, 45.064357336499874, 305,
            7.681844786947655, 45.064700664973465, 305,
            7.682176507499465, 45.064548636167046, 305,
            7.681927460378208, 45.06424311692661, 305
        ]),
        material: new Cesium.ColorMaterialProperty(
            Cesium.Color.BLUE.withAlpha(0.2)
        ),
        perPositionHeight: true,
        extrudedHeight: 280,
        outline: false
    },
    properties: {
        immagine: "assets/img/dune.jpg",
        investimentiPartnership: "Prop trading, Local Co-Investor",
        surface: " - m²",
        apartments: " 25",
        trackRecord: " 6.550.000 €",
        icona: "assets/icons/dune.png",
        descrizione: `At number 35 of the prestigious Via Lagrange, a new residential
                        iconic as well as eco-friendly building will see the light. The restyling
                        of the main façade stands out for its courtly linearity in which
                        aesthetics and functionality coexist in perfect harmony. Its design is
                        meant to satisfy the highest contemporary housing needs. Led by
                        the growing awareness about the need to design and build with
                        a low environmental impact, we are constantly searching for new
                        materials, systems and finishes in harmony with the physical and
                        cultural environment.`
    }
});

viewer.entities.add({
    id: "Doria",
    name: "Casa Doria",
    polygon: {
        hierarchy: Cesium.Cartesian3.fromDegreesArrayHeights([
            7.682120690405117, 45.06418590910793, 305,
            7.682513688725606, 45.064101626154304, 305,
            7.682636477430582, 45.06434861024248, 305,
            7.682230084366958, 45.06442541401784, 305
        ]),
        material: new Cesium.ColorMaterialProperty(
            Cesium.Color.BLUE.withAlpha(0.2)
        ),
        perPositionHeight: true,
        extrudedHeight: 280,
        outline: false
    },
    properties: {
        immagine: "assets/img/doria.png",
        investimentiPartnership: "Prop trading, Local Co-Investor",
        surface: " - m²",
        apartments: " 19",
        trackRecord: " 5.300.000 €",
        icona: "assets/icons/doria.png",
        descrizione: `At Via Andrea Doria 7, on the corner of Via Lagrange, in the heart
                        of Turin, the new fine Casadoria residential complex will couple Turin
                        heritage style with contemporary architecture. This prestigious building
                        will feature 15 apartments, 5 garages and 8 parking spaces.`
    }
});

viewer.entities.add({
    id: "Ellen",
    name: "Palazzo Ellen",
    polygon: {
        hierarchy: Cesium.Cartesian3.fromDegreesArrayHeights([
            7.681864849664294, 45.06569389928816, 315,
            7.682441346225534, 45.06549735990407, 315,
            7.682153844891726, 45.06513505384391, 315,
            7.6816062590801195, 45.06533413668166, 315
        ]),
        material: new Cesium.ColorMaterialProperty(
            Cesium.Color.BLUE.withAlpha(0.2)
        ),
        perPositionHeight: true,
        extrudedHeight: 280,
        outline: false
    },
    properties: {
        immagine: "assets/img/ellen.png",
        investimentiPartnership: "Prop trading, Local Co-Investor",
        surface: " 4000 m²",
        apartments: " 26",
        trackRecord: " 23.100.000 €",
        icona: "assets/icons/ellen.png",
        descrizione: `The new prestigious real estate operation of 4000
                        m² and 26 apartments, transforms and innovates the
                        rationalist rigour of the building at Via Lagrange 24 into
                        contemporary design, while maintaining the characteristics of
                        sumptuousness and elegance, typical of the rationalist architectural
                        style of the 1930s.`
    }
});

viewer.entities.add({
    id: "Accademia",
    name: "Accademia 38",
    polygon: {
        hierarchy: Cesium.Cartesian3.fromDegreesArrayHeights([
            7.685342475223557, 45.06120802769718, 305,
            7.685599438712176, 45.06157242005522, 305,
            7.685072485451941, 45.061745047287616, 305,
            7.684830559508038, 45.061393199758385, 305
        ]),
        material: new Cesium.ColorMaterialProperty(
            Cesium.Color.BLUE.withAlpha(0.2)
        ),
        perPositionHeight: true,
        extrudedHeight: 280,
        outline: false
    },
    properties: {
        immagine: "assets/img/accademia.jpg",
        investimentiPartnership: "Prop trading",
        surface: " 4500 m²",
        apartments: " 50",
        trackRecord: " 14.500.000 €",
        icona: "assets/icons/accademia.png",
        descrizione: `Accademia 38 is not just a prestigious building, but a view of the Turin
                        of the late nineteenth century, revisited to adapt the contemporary
                        lifestyle.
                        The 4500 m² project, 50 real estate units and 4 car garages, is a
                        conservative renovation of a residential building in the center of Turin.`
    }
});

viewer.entities.add({
    id: "Betulle1",
    name: "Betulle 1",
    polygon: {
        hierarchy: Cesium.Cartesian3.fromDegreesArrayHeights([
            7.7196593529471125, 45.18305735304931, 315,
            7.719780022404747, 45.183259120469586, 315,
            7.719811648675973, 45.18332981468679, 315,
            7.719850305316958, 45.183423325413585, 315,
            7.719907512146784, 45.183557497819805, 315,
            7.719941102900807, 45.18366256411796, 315,
            7.719960148846169, 45.18375980384026, 315,
            7.720001532689547, 45.18391320972729, 315,
            7.720009103684815, 45.18395165410968, 315,
            7.720024144963868, 45.18402857276477, 315,
            7.7200406874227845, 45.18411278991568, 315,
            7.7200626062500906, 45.184224483180664, 315,
            7.720070503860997, 45.18429585642793, 315,
            7.7200817506052, 45.18443475089855, 315,
            7.720098110697111, 45.18462555584223, 315,
            7.720103011909091, 45.18469179000765, 315,
            7.7201448585989345, 45.18474000706714, 315,
            7.720186075651889, 45.184744078609015, 315,
            7.7202338974689, 45.18476379767505, 315,
            7.720283444770689, 45.18478405462445, 315,
            7.720325869586049, 45.18482511286925, 315,
            7.720351587405987, 45.184848037399775, 315,
            7.720372371394186, 45.184893096194244, 315,
            7.721506728065749, 45.18486429898128, 315,
            7.721438644767417, 45.18458346254746, 315,
            7.721402363562325, 45.18441556041859, 315,
            7.721375708144242, 45.18423636154434, 315,
            7.7211435317534685, 45.182953571526085, 315,
            7.721055192636664, 45.18267441186636, 315
        ]),
        material: new Cesium.ColorMaterialProperty(
            Cesium.Color.BLUE.withAlpha(0.2)
        ),
        perPositionHeight: true,
        extrudedHeight: 280,
        outline: false
    },
    properties: {
        immagine: "assets/img/betulle_1.jpg",
        investimentiPartnership: "Prop trading",
        surface: " 90.000 m²",
        apartments: " 452",
        trackRecord: " 82.000.000 €",
        icona: "assets/icons/betulle.png",
        descrizione: `Residential complex within a territorial planning
                        intervention, which defines the skyline of Leinì. The urban
                        center of the metropolitan city of Turin in recent years has
                        developed strongly, becoming a new large residential
                        center, due to our building of more than 90000 m² for a
                        total of 452 apartments, 46 stores and 545 boxes and 1
                        supermarket of 2200 m².
                        The district includes different housing solutions: some
                        with large garden in the open countryside, others with
                        panoramic terraces on the Alps mountain range.`
    }
});

viewer.entities.add({
    id: "Betulle2",
    name: "Betulle 2",
    polygon: {
        hierarchy: Cesium.Cartesian3.fromDegreesArrayHeights([
            7.719841939983819, 45.18071376497135, 315,
            7.71866200055144, 45.18103676104945, 315,
            7.718617787682093, 45.18103825619338, 315,
            7.718537778803328, 45.18102955349827, 315,
            7.71849527267995, 45.18101303921736, 315,
            7.71843599940826, 45.180975339554365, 315,
            7.718317803871925, 45.180912592414444, 315,
            7.718059074210685, 45.180707663606114, 315,
            7.717924207207346, 45.180592702490884, 315,
            7.717844990799606, 45.18054354376526, 315,
            7.71772186262885, 45.18047490115032, 315,
            7.717615626488032, 45.18042048480184, 315,
            7.7174459577284065, 45.1803320013775, 315,
            7.7173206669902745, 45.18027288704596, 315,
            7.717197814280216, 45.18021303701967, 315,
            7.717079369073502, 45.18017311730605, 315,
            7.716996863222489, 45.180144524924685, 315,
            7.717095708505585, 45.17982945195777, 315,
            7.717171201457099, 45.17965818121151, 315,
            7.717222437362741, 45.179426505478375, 315,
            7.717237878341116, 45.17930972026463, 315,
            7.71726330613814, 45.17919593400195, 315,
            7.717300986597008, 45.179092388723845, 315,
            7.71729632754488, 45.17895837632175, 315,
            7.717295355054543, 45.1788807830123, 315,
            7.717260574378268, 45.17880813746501, 315,
            7.717296570425615, 45.17876379364835, 315,
            7.717349159429455, 45.17874920554517, 315,
            7.717469724222185, 45.17877959512973, 315,
            7.717572135091958, 45.17879565719509, 315,
            7.717671335771197, 45.17881572145123, 315,
            7.7177542224323314, 45.178839144651946, 315,
            7.717836356607362, 45.17885102238529, 315,
            7.717938983379119, 45.178881917330436, 315,
            7.718053889239331, 45.17891424646855, 315,
            7.718152792303451, 45.178945007874525, 315,
            7.718287334954889, 45.178990871038714, 315,
            7.718427374231812, 45.179044749963474, 315,
            7.718570503509988, 45.17910337417436, 315,
            7.718721014987454, 45.17916788204561, 315,
            7.718851911206131, 45.1792290334548, 315,
            7.7189586154438725, 45.17929427475745, 315,
            7.719037993440974, 45.17933901781094, 315
        ]),
        material: new Cesium.ColorMaterialProperty(
            Cesium.Color.BLUE.withAlpha(0.2)
        ),
        perPositionHeight: true,
        extrudedHeight: 280,
        outline: false
    },
    properties: {
        immagine: "assets/img/betulle_2.jpg",
        investimentiPartnership: "Prop trading",
        surface: " 90.000 m²",
        apartments: " 452",
        trackRecord: " 82.000.000 €",
        icona: "assets/icons/betulle.png",
        descrizione: `Residential complex within a territorial planning
                        intervention, which defines the skyline of Leinì. The urban
                        center of the metropolitan city of Turin in recent years has
                        developed strongly, becoming a new large residential
                        center, due to our building of more than 90000 m² for a
                        total of 452 apartments, 46 stores and 545 boxes and 1
                        supermarket of 2200 m².
                        The district includes different housing solutions: some
                        with large garden in the open countryside, others with
                        panoramic terraces on the Alps mountain range.`
    }
});

addMarkersToAllLotti();
window.addEventListener("resize", applySelectedOverlayResponsiveStyles);
buildPolygonButtonsMenu();
bindOperationsMenuEvents();
setOperationsMenuOpen(false);
buildPartnershipFiltersPanel();

viewer.entities.values.forEach((entity) => {
    if (entity.polygon) {
        entity.show = true;
    }
});

applyPartnershipFilter();
refreshLotMarkersVisibility();
refreshSelectedLotOverlayVisibility();

// =========================
// CLICK LOTTI
// =========================

const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

handler.setInputAction((movement) => {
    const pickedObject = viewer.scene.pick(movement.position);

    if (!Cesium.defined(pickedObject) || !Cesium.defined(pickedObject.id)) {
        return;
    }

    let entity = pickedObject.id;

    if (
        !entity.polygon &&
        (
            getProp(entity, "isLotMarker") ||
            getProp(entity, "isLotSelectedOverlay")
        )
    ) {
        const linkedEntityId = getProp(entity, "linkedEntityId");
        const linkedEntity = viewer.entities.getById(linkedEntityId);
        if (linkedEntity) {
            entity = linkedEntity;
        }
    }

    if (entity.polygon && Cesium.defined(entity.properties) && entity.show !== false) {
        handlePolygonSelection(entity, { closeMenuAfterSelect: false });
    }
}, Cesium.ScreenSpaceEventType.LEFT_CLICK);

// =========================
// CLICK DESTRO DEBUG PUNTI
// =========================

const drawHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

drawHandler.setInputAction((movement) => {
    let pickedPosition = viewer.scene.pickPosition(movement.position);

    if (!Cesium.defined(pickedPosition)) {
        const ray = viewer.camera.getPickRay(movement.position);
        pickedPosition = viewer.scene.globe.pick(ray, viewer.scene);
    }

    if (!Cesium.defined(pickedPosition)) return;

    lottoPoints.push(pickedPosition);
    addPointMarker(pickedPosition);
    createLivePreview();

    const cartographic = Cesium.Cartographic.fromCartesian(pickedPosition);
    const lon = Cesium.Math.toDegrees(cartographic.longitude);
    const lat = Cesium.Math.toDegrees(cartographic.latitude);
    const height = cartographic.height;

    console.log("Punto aggiunto:");
    console.log("Lon:", lon);
    console.log("Lat:", lat);
    console.log("Height:", height);
}, Cesium.ScreenSpaceEventType.RIGHT_CLICK);