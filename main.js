Cesium.Ion.defaultAccessToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiIzMDMzYWFiYy03NmQ2LTQ1Y2ItOTIxMC00YTlhNWJiOTczYTEiLCJpZCI6MjI5OTIwLCJpYXQiOjE3MzUxNDI5ODN9.5JsxkFNj9aTyDXASAq5If6K6oQmBRtw4-xzKA0-ksec";

const viewer = new Cesium.Viewer("cesiumContainer", {
    timeline: false,
    animation: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    fullscreenButton: true,
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

canvas.style.touchAction = "none";

let isOrbitMode = false;
let currentOrbitTarget = null;
let isViewerUnlocked = false;

let orbitHeading = Cesium.Math.toRadians(55);
let orbitPitch = Cesium.Math.toRadians(-35);
let orbitRange = 260;

const minPitch = Cesium.Math.toRadians(-80);
const maxPitch = Cesium.Math.toRadians(-10);
const minRange = 120;
const maxRange = 900;

const initialCameraView = {
    destination: Cesium.Cartesian3.fromDegrees(
        7.6858472,
        45.0709417,
        4500
    ),
    orientation: {
        heading: Cesium.Math.toRadians(25),
        pitch: Cesium.Math.toRadians(-89),
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
    viewer.camera.setView(initialCameraView);

    syncViewerControls();

    if (homeViewButton) {
        homeViewButton.classList.add("hidden");
    }

    setActivePolygonMenuButton("");
}

function focusPolygonAndLockView(entity) {
    const hierarchy = getEntityHierarchy(entity);
    const positions = hierarchy?.positions || [];
    if (!positions.length) return;

    const boundingSphere = Cesium.BoundingSphere.fromPoints(positions);
    currentOrbitTarget = boundingSphere.center;

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

closePanel.addEventListener("click", closeInfoPanel);

function getAllLotti() {
    return viewer.entities.values.filter(entity =>
        entity.polygon && entity.properties
    );
}

function getPolygonGroupsForMenu() {
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
    infoEyebrow.textContent = "Operazione immobiliare";
    lotTitle.textContent = entity.name || "Lotto";

    const immagine = formatValue(getProp(entity, "immagine"));
    const investimentiPartnership = formatValue(getProp(entity, "investimentiPartnership"));
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

            <div class="info-text-block">
                <span>Descrizione</span>
                <p>${descrizione}</p>
            </div>
        </div>
    `;

    openInfoPanel();
}

function handlePolygonSelection(entity, options = {}) {
    if (!entity) return;

    blinkPolygon(entity);
    renderSingleLotInfo(entity);
    focusPolygonAndLockView(entity);
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

// =========================
// LABEL LOTTI
// =========================

const lotLabelEntities = [];
const lotIconEntities = [];

function buildLotIconEntity(name, entities) {
    const basePosition = getCenterFromEntities(entities);
    if (!basePosition) return null;

    const primaryEntity = entities[0];

    const cartographic = Cesium.Cartographic.fromCartesian(basePosition);
    const iconPosition = Cesium.Cartesian3.fromRadians(
        cartographic.longitude,
        cartographic.latitude,
        cartographic.height + 26
    );

    const iconEntity = viewer.entities.add({
        id: `icon_${primaryEntity.id}`,
        name: `${name}_icon`,
        position: iconPosition,
        properties: {
            isLotIcon: true,
            linkedEntityId: primaryEntity.id
        },
        billboard: {
            image: "assets/icons/cantiere-marker.png",
            width: 70,
            height: 70,
            horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
            verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            pixelOffset: new Cesium.Cartesian2(0, 0),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            scaleByDistance: new Cesium.NearFarScalar(180.0, 1.0, 2200.0, 0.82)
        }
    });

    iconEntity._linkedEntities = entities;
    return iconEntity;
}

function getEntityHierarchy(entity) {
    const hierarchyProperty = entity?.polygon?.hierarchy;
    if (!hierarchyProperty) return null;

    return hierarchyProperty.getValue
        ? hierarchyProperty.getValue(Cesium.JulianDate.now())
        : hierarchyProperty;
}

function isTabletLandscapeViewport() {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
        return false;
    }

    return window.matchMedia("(orientation: landscape) and (min-width: 1024px) and (max-width: 1400px) and (max-height: 950px)").matches;
}

function getLotLabelAppearance() {
    if (isTabletLandscapeViewport()) {
        return {
            font: "900 25px Inter, system-ui, sans-serif",
            outlineWidth: 1,
            backgroundPadding: new Cesium.Cartesian2(0, 0),
            scaleByDistance: new Cesium.NearFarScalar(180.0, 1.15, 2200.0, 0.92)
        };
    }

    return {
        font: "900 25px Inter, system-ui, sans-serif",
        outlineWidth: 1,
        backgroundPadding: new Cesium.Cartesian2(0, 0),
        scaleByDistance: new Cesium.NearFarScalar(180.0, 1.15, 2200.0, 0.92)
    };
}

function applyLotLabelResponsiveStyles() {
    const appearance = getLotLabelAppearance();

    lotLabelEntities.forEach((labelEntity) => {
        if (!labelEntity?.label) return;
        labelEntity.label.font = appearance.font;
        labelEntity.label.fillColor = Cesium.Color.fromCssColorString("#F6F3EE");
        labelEntity.label.outlineColor = Cesium.Color.fromCssColorString("rgba(0, 0, 0, 0.45)");
        labelEntity.label.outlineWidth = 1;
        labelEntity.label.style = Cesium.LabelStyle.FILL_AND_OUTLINE;
        labelEntity.label.showBackground = false;
        labelEntity.label.backgroundPadding = appearance.backgroundPadding;
        labelEntity.label.scaleByDistance = appearance.scaleByDistance;
    });
}

function getCenterFromEntities(entities) {
    const positions = entities.flatMap(entity => getEntityHierarchy(entity)?.positions || []);

    if (!positions.length) return null;

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

    const labelHeight = Math.max(maxHeight, ...extrudedHeights.filter(value => typeof value === "number"), 0) + 10;

    return Cesium.Cartesian3.fromRadians(averageLon, averageLat, labelHeight);
}

function buildLotLabelEntity(name, entities) {
    const labelPosition = getCenterFromEntities(entities);
    if (!labelPosition) return null;

    const primaryEntity = entities[0];
    const appearance = getLotLabelAppearance();

    const labelEntity = viewer.entities.add({
        id: `label_${primaryEntity.id}`,
        name,
        position: labelPosition,
        properties: {
            isLotLabel: true,
            linkedEntityId: primaryEntity.id
        },
        label: {
            text: name,
            font: appearance.font,
            fillColor: Cesium.Color.fromCssColorString("#F6F3EE"),
            outlineColor: Cesium.Color.fromCssColorString("rgba(0, 0, 0, 0.45)"),
            outlineWidth: 1,
            style: Cesium.LabelStyle.FILL_AND_OUTLINE,
            showBackground: false,
            backgroundPadding: appearance.backgroundPadding,
            horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
            verticalOrigin: Cesium.VerticalOrigin.CENTER,
            heightReference: Cesium.HeightReference.NONE,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
            distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0.0, 2200.0),
            scaleByDistance: appearance.scaleByDistance
        }
    });

    labelEntity._linkedEntities = entities;
    return labelEntity;
}

function addLabelsToAllLotti() {
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
        const labelEntity = buildLotLabelEntity(name, entities);
        if (labelEntity) {
            lotLabelEntities.push(labelEntity);
        }

        const iconEntity = buildLotIconEntity(name, entities);
        if (iconEntity) {
            lotIconEntities.push(iconEntity);
        }
    });

    refreshLotLabelsVisibility();
    refreshLotIconsVisibility();
}

function refreshLotIconsVisibility() {
    lotIconEntities.forEach((iconEntity) => {
        const linkedEntities = iconEntity._linkedEntities || [];
        iconEntity.show = linkedEntities.some(entity => entity.show !== false);
    });
}

function refreshLotLabelsVisibility() {
    lotLabelEntities.forEach((labelEntity) => {
        const linkedEntities = labelEntity._linkedEntities || [];
        labelEntity.show = linkedEntities.some(entity => entity.show !== false);
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
            Cesium.Color.RED.withAlpha(0.2)
        ),
        perPositionHeight: true,
        extrudedHeight: 285,
        outline: false
    },
    properties: {
        immagine: "assets/img/pacioli.jpeg",
        investimentiPartnership: "Investimenti & Partnership",
        descrizione: "Descrizione del progetto Palazzo Pacioli."
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
            Cesium.Color.RED.withAlpha(0.2)
        ),
        perPositionHeight: true,
        extrudedHeight: 285,
        outline: false
    },
    properties: {
        immagine: "assets/img/velo.jpg",
        investimentiPartnership: "Investimenti & Partnership",
        descrizione: "Descrizione del progetto Casa Vélo."
    }
});

viewer.entities.add({
    id: "Alfieri",
    name: "Angoli",
    polygon: {
        hierarchy: Cesium.Cartesian3.fromDegreesArrayHeights([
            7.677751532298875, 45.068316182918814, 315,
            7.6783465742329575, 45.068115905344634, 315,
            7.678580187544821, 45.06842887263733, 315,
            7.67797094993596, 45.06864785502038, 315
        ]),
        material: new Cesium.ColorMaterialProperty(
            Cesium.Color.RED.withAlpha(0.2)
        ),
        perPositionHeight: true,
        extrudedHeight: 285,
        outline: false
    },
    properties: {
        immagine: "assets/img/alfieri.jpg",
        investimentiPartnership: "Investimenti & Partnership",
        descrizione: "Descrizione del progetto Casa Vélo."
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
            Cesium.Color.RED.withAlpha(0.2)
        ),
        perPositionHeight: true,
        extrudedHeight: 280,
        outline: false
    },
    properties: {
        immagine: "assets/img/molassi.jpg",
        investimentiPartnership: "Investimenti & Partnership",
        descrizione: "Descrizione del progetto Casa Vélo."
    }
});

addLabelsToAllLotti();
window.addEventListener("resize", applyLotLabelResponsiveStyles);
buildPolygonButtonsMenu();
bindOperationsMenuEvents();
setOperationsMenuOpen(false);

viewer.entities.values.forEach((entity) => {
    if (entity.polygon) {
        entity.show = true;
    }
});
refreshLotLabelsVisibility();
refreshLotIconsVisibility();

// =========================
// CLICK LOTTI
// =========================

const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

handler.setInputAction((movement) => {
    const pickedObject = viewer.scene.pick(movement.position);

    if (
        Cesium.defined(pickedObject) &&
        Cesium.defined(pickedObject.id) &&
        Cesium.defined(pickedObject.id.properties)
    ) {
        let entity = pickedObject.id;

        if (
            !entity.polygon &&
            (getProp(entity, "isLotLabel") || getProp(entity, "isLotIcon"))
        ) {
            const linkedEntityId = getProp(entity, "linkedEntityId");
            const linkedEntity = viewer.entities.getById(linkedEntityId);
            if (linkedEntity) {
                entity = linkedEntity;
            }
        }

        if (entity.polygon) {
            handlePolygonSelection(entity, { closeMenuAfterSelect: false });
        }
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