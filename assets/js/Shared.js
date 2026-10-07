var STORM_DATA_URL = "/api/CurrentStorms.json";
var CLASSIFICATION_LABELS = {
    STD: "Subtropical Depression",
    TD: "Tropical Depression",
    STS: "Subtropical Storm",
    TS: "Tropical Storm",
    HU: "Hurricane",
    PTC: "Post-tropical Cyclone",
    PC: "Potential Tropical Cyclone",
    TY: "Typhoon"
};

function loadStorms() {
    return fetch(STORM_DATA_URL).then(function(response) {
        if (!response.ok) {
            throw new Error("Storm request failed");
        }
        return response.json();
    });
}

function classificationLabel(code) {
    return CLASSIFICATION_LABELS[code] || code || "Storm";
}

function knotsToMph(knots) {
    var value = Number(knots);
    if (!isFinite(value)) {
        return null;
    }
    return Math.round(value * 1.15078);
}

function windText(knots) {
    var mph = knotsToMph(knots);
    if (mph == null) {
        return "Wind unavailable";
    }
    return mph + " mph (" + Number(knots) + " kt)";
}

function getCardinalDirection(degree) {
    if (typeof degree !== "number" || isNaN(degree)) {
        return "";
    }
    if (degree >= 0 && degree <= 44) return "North";
    if (degree >= 45 && degree <= 89) return "Northeast";
    if (degree >= 90 && degree <= 134) return "East";
    if (degree >= 135 && degree <= 179) return "Southeast";
    if (degree >= 180 && degree <= 224) return "South";
    if (degree >= 225 && degree <= 269) return "Southwest";
    if (degree >= 270 && degree <= 314) return "West";
    return "Northwest";
}

function movementText(storm) {
    var direction = getCardinalDirection(Number(storm.movementDir));
    var speed = knotsToMph(storm.movementSpeed);
    if (!direction) {
        return "Movement unavailable";
    }
    if (speed == null) {
        return "Moving " + direction;
    }
    return direction + " at " + speed + " mph";
}

function setupHurricaneNews() {
    var news = document.getElementById("news");
    loadStorms()
        .then(function(data) {
            var storms = data.activeStorms || [];
            if (!storms.length) {
                news.innerHTML = "<p class=\"empty-state\">No active storms right now.</p>";
                return;
            }
            news.innerHTML = storms.map(stormCard).join("");
        })
        .catch(function() {
            news.innerHTML = "<p class=\"empty-state\">Storm news is unavailable right now.</p>";
        })
        .finally(function() {
            var loading = document.getElementById("loading");
            if (loading) {
                loading.remove();
            }
        });
}

function stormCard(storm) {
    var advisory = storm.publicAdvisory && storm.publicAdvisory.url;
    return ""
        + "<article class=\"storm-card\">"
        + "<div class=\"storm-card-top\">"
        + "<span class=\"pill " + escapeHtml(storm.classification) + "\">" + escapeHtml(classificationLabel(storm.classification)) + "</span>"
        + "<h2>" + escapeHtml(storm.name) + "</h2>"
        + "</div>"
        + "<dl>"
        + "<div><dt>Wind</dt><dd>" + escapeHtml(windText(storm.intensity)) + "</dd></div>"
        + "<div><dt>Pressure</dt><dd>" + escapeHtml(storm.pressure || "—") + " mb</dd></div>"
        + "<div><dt>Motion</dt><dd>" + escapeHtml(movementText(storm)) + "</dd></div>"
        + "</dl>"
        + "<div class=\"card-actions\">"
        + "<a class=\"text-button\" href=\"dynamicMap.html#" + encodeURIComponent(storm.id) + "\">View forecast track</a>"
        + (advisory ? "<a class=\"text-button quiet\" href=\"" + escapeHtml(advisory) + "\" target=\"_blank\" rel=\"noopener\">Public advisory</a>" : "")
        + "</div>"
        + "</article>";
}

function setupHurricaneData() {
    if (!window.tracker) {
        return;
    }
    var list = document.getElementById("storm-list");
    var toggle = document.getElementById("basemap-toggle");
    var satelliteOn = true;
    if (toggle) {
        toggle.addEventListener("click", function() {
            satelliteOn = !satelliteOn;
            window.tracker.setBasemap(satelliteOn ? "satellite" : "streets");
            toggle.textContent = satelliteOn ? "Street map" : "Satellite";
        });
    }

    loadStorms()
        .then(function(data) {
            var storms = data.activeStorms || [];
            if (!storms.length) {
                list.innerHTML = "<p class=\"empty-state\">No active storms right now.</p>";
                return null;
            }
            return Promise.all(storms.map(function(storm, index) {
                return Promise.all([
                    loadForecast(storm.forecastTrack && storm.forecastTrack.kmzFile),
                    loadForecast(storm.trackCone && storm.trackCone.kmzFile)
                ]).then(function(parts) {
                    return {
                        storm: storm,
                        color: STORM_COLORS[index % STORM_COLORS.length],
                        track: parts[0],
                        cone: parts[1]
                    };
                });
            }));
        })
        .then(function(results) {
            if (!results) {
                return;
            }
            drawStorms(results);
            renderStormList(results);
            var requested = decodeURIComponent((location.hash || "").replace("#", ""));
            var match = results.filter(function(item) { return item.storm.id === requested; })[0];
            focusStorm(match ? match.storm.id : null);
        })
        .catch(function() {
            if (list) {
                list.innerHTML = "<p class=\"empty-state\">Storm tracks are unavailable right now.</p>";
            }
        });
}

function loadForecast(kmzUrl) {
    if (!kmzUrl) {
        return Promise.resolve(null);
    }
    return fetch("/api/forecast?kmz=" + encodeURIComponent(kmzUrl))
        .then(function(response) {
            if (!response.ok) {
                throw new Error("Forecast request failed");
            }
            return response.json();
        })
        .catch(function() {
            return null;
        });
}

function drawStorms(results) {
    var source = window.tracker.forecastSource;
    var format = new ol.format.GeoJSON();
    source.clear();
    results.forEach(function(item) {
        addCollection(format, source, item.cone, item, "cone");
    });
    results.forEach(function(item) {
        addCollection(format, source, item.track, item, "track-long");
    });
    results.forEach(function(item) {
        addCollection(format, source, item.track, item, "track-short");
    });
    results.forEach(function(item) {
        addCollection(format, source, item.track, item, "point");
        source.addFeature(currentFeature(item));
    });
}

function addCollection(format, source, collection, item, mode) {
    if (!collection || !collection.features) {
        return;
    }
    var selected = collection.features.filter(function(feature) {
        var kind = feature.properties && feature.properties.kind;
        var hours = Number(feature.properties && feature.properties.hours);
        if (mode === "cone") return kind === "cone";
        if (mode === "point") return kind === "point";
        if (mode === "track-long") return kind === "track" && hours > 72;
        if (mode === "track-short") return kind === "track" && hours <= 72;
        return false;
    });
    if (!selected.length) {
        return;
    }
    var features = format.readFeatures(
        { type: "FeatureCollection", features: selected },
        { dataProjection: "EPSG:4326", featureProjection: "EPSG:3857" }
    );
    features.forEach(function(feature) {
        feature.set("color", item.color);
        feature.set("stormName", item.storm.name);
        feature.set("stormId", item.storm.id);
    });
    source.addFeatures(features);
}

function currentFeature(item) {
    var storm = item.storm;
    var feature = new ol.Feature({
        geometry: new ol.geom.Point(ol.proj.fromLonLat([
            Number(storm.longitudeNumeric),
            Number(storm.latitudeNumeric)
        ])),
        kind: "current",
        label: storm.name,
        stormName: storm.name,
        stormId: storm.id,
        color: item.color,
        summary: classificationLabel(storm.classification) + " · " + windText(storm.intensity) + " · " + movementText(storm)
    });
    return feature;
}

function renderStormList(results) {
    var list = document.getElementById("storm-list");
    if (!list) {
        return;
    }
    list.innerHTML = results.map(function(item) {
        var storm = item.storm;
        var points = forecastPoints(item.track);
        var rows = points.map(function(point) {
            var props = point.properties;
            return "<li><span>" + escapeHtml(props.label) + "</span><span>" + escapeHtml(props.wind || "") + "</span></li>";
        }).join("");
        return ""
            + "<article class=\"storm-item\" data-id=\"" + escapeHtml(storm.id) + "\">"
            + "<button type=\"button\" class=\"storm-focus\" data-id=\"" + escapeHtml(storm.id) + "\">"
            + "<span class=\"swatch\" style=\"background:" + item.color + "\"></span>"
            + "<span class=\"storm-focus-copy\">"
            + "<span class=\"pill " + escapeHtml(storm.classification) + "\">" + escapeHtml(classificationLabel(storm.classification)) + "</span>"
            + "<strong>" + escapeHtml(storm.name) + "</strong>"
            + "<em>" + escapeHtml(windText(storm.intensity)) + " · " + escapeHtml(storm.pressure || "—") + " mb</em>"
            + "<em>" + escapeHtml(movementText(storm)) + "</em>"
            + "</span>"
            + "</button>"
            + (rows ? "<ol class=\"forecast-list\">" + rows + "</ol>" : "")
            + "</article>";
    }).join("");
    list.querySelectorAll(".storm-focus").forEach(function(button) {
        button.addEventListener("click", function() {
            focusStorm(button.getAttribute("data-id"));
        });
    });
}

function forecastPoints(collection) {
    if (!collection || !collection.features) {
        return [];
    }
    return collection.features
        .filter(function(feature) { return feature.properties && feature.properties.kind === "point"; })
        .sort(function(a, b) { return a.properties.hour - b.properties.hour; });
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

function focusStorm(stormId) {
    var source = window.tracker.forecastSource;
    var features = source.getFeatures().filter(function(feature) {
        return !stormId || feature.get("stormId") === stormId;
    });
    if (!features.length) {
        return;
    }
    var extent = ol.extent.createEmpty();
    features.forEach(function(feature) {
        ol.extent.extend(extent, feature.getGeometry().getExtent());
    });
    var narrow = window.innerWidth < 860;
    window.tracker.map.updateSize();
    window.tracker.map.getView().fit(extent, {
        padding: narrow ? [64, 24, 250, 24] : [64, 390, 48, 48],
        maxZoom: 6,
        duration: 350
    });
    document.querySelectorAll(".storm-item").forEach(function(item) {
        item.classList.toggle("is-selected", item.getAttribute("data-id") === stormId);
    });
}
