var STORM_COLORS = ["#ffb703", "#ff5d8f", "#48cae4", "#c4f54a", "#c77dff"];

function createHurricaneMap(options) {
    var interactive = !options || options.interactive !== false;
    var satellite = new ol.layer.Tile({
        source: new ol.source.XYZ({
            url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
            maxZoom: 19,
            attributions: "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community"
        })
    });
    var labels = new ol.layer.Tile({
        source: new ol.source.XYZ({
            url: "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
            maxZoom: 19,
            attributions: "Labels © Esri"
        })
    });
    var streets = new ol.layer.Tile({
        source: new ol.source.OSM(),
        visible: false
    });
    var forecastSource = new ol.source.Vector();
    var forecastLayer = new ol.layer.Vector({
        source: forecastSource,
        style: forecastStyle
    });
    var map = new ol.Map({
        target: "map",
        layers: [satellite, streets, labels, forecastLayer],
        controls: interactive
            ? ol.control.defaults({ attributionOptions: { collapsible: false } })
            : [new ol.control.Attribution({ collapsible: false })],
        interactions: interactive ? ol.interaction.defaults() : [],
        view: new ol.View({
            center: ol.proj.fromLonLat([-95, 24]),
            zoom: 4,
            minZoom: 2,
            maxZoom: 12
        })
    });
    var popupElement = document.getElementById("map-popup");
    var popup = new ol.Overlay({
        element: popupElement,
        positioning: "bottom-center",
        offset: [0, -14],
        stopEvent: true
    });
    map.addOverlay(popup);

    function featureAt(pixel) {
        var found = null;
        map.forEachFeatureAtPixel(pixel, function(feature) {
            if (feature.get("kind") === "cone") {
                return undefined;
            }
            found = feature;
            return true;
        }, { hitTolerance: 6 });
        return found;
    }

    map.on("pointermove", function(event) {
        if (!interactive) {
            return;
        }
        map.getTargetElement().style.cursor = featureAt(event.pixel) ? "pointer" : "";
    });
    map.on("click", function(event) {
        var feature = featureAt(event.pixel);
        if (!feature || !popupElement) {
            popup.setPosition(undefined);
            if (popupElement) {
                popupElement.classList.remove("is-open");
            }
            return;
        }
        popupElement.innerHTML = popupHtml(feature);
        popupElement.classList.add("is-open");
        popup.setPosition(event.coordinate);
    });

    return {
        map: map,
        forecastSource: forecastSource,
        satellite: satellite,
        labels: labels,
        streets: streets,
        setBasemap: function(mode) {
            var useSatellite = mode !== "streets";
            satellite.setVisible(useSatellite);
            labels.setVisible(useSatellite);
            streets.setVisible(!useSatellite);
        }
    };
}

function forecastStyle(feature) {
    var kind = feature.get("kind");
    var color = feature.get("color") || "#ffffff";
    if (kind === "cone") {
        return new ol.style.Style({
            fill: new ol.style.Fill({ color: "rgba(255,255,255,0.18)" }),
            stroke: new ol.style.Stroke({ color: "rgba(255,255,255,0.85)", width: 1.25 })
        });
    }
    if (kind === "track") {
        var extended = Number(feature.get("hours")) > 72;
        return [
            new ol.style.Style({
                stroke: new ol.style.Stroke({
                    color: "rgba(0,0,0,0.55)",
                    width: extended ? 6 : 8
                })
            }),
            new ol.style.Style({
                stroke: new ol.style.Stroke({
                    color: color,
                    width: extended ? 2.5 : 3.5,
                    lineDash: extended ? [1, 12] : undefined
                })
            })
        ];
    }
    var isCurrent = kind === "current";
    return new ol.style.Style({
        image: new ol.style.Circle({
            radius: isCurrent ? 8 : 5,
            fill: new ol.style.Fill({ color: color }),
            stroke: new ol.style.Stroke({ color: "#ffffff", width: isCurrent ? 3 : 2 })
        }),
        text: new ol.style.Text({
            text: feature.get("label") || "",
            offsetY: isCurrent ? 18 : -14,
            font: isCurrent ? "700 13px Segoe UI, sans-serif" : "600 12px Segoe UI, sans-serif",
            fill: new ol.style.Fill({ color: "#ffffff" }),
            stroke: new ol.style.Stroke({ color: "#071018", width: 4 })
        })
    });
}

function popupHtml(feature) {
    var title = escapeHtml(feature.get("stormName") || "Storm");
    var rows = "";
    if (feature.get("kind") === "current") {
        rows = "<p>" + escapeHtml(feature.get("summary") || "Current position") + "</p>";
    } else if (feature.get("kind") === "point") {
        rows = "<p>" + escapeHtml(feature.get("label") || "Forecast") + " position</p>";
        if (feature.get("valid")) {
            rows += "<p>" + escapeHtml(feature.get("valid")) + "</p>";
        }
        if (feature.get("wind")) {
            rows += "<p>Max wind " + escapeHtml(feature.get("wind")) + "</p>";
        }
    } else {
        rows = "<p>" + escapeHtml(String(feature.get("hours") || "")) + "-hour forecast track</p>";
    }
    return "<strong>" + title + "</strong>" + rows;
}

function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function(character) {
        return {
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            "\"": "&quot;",
            "'": "&#39;"
        }[character];
    });
}
