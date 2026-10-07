var HURRICANE_SERVICE = "https://services9.arcgis.com/RHVPKKiFTONKtxq3/arcgis/rest/services/Active_Hurricanes_v1/FeatureServer";
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
    return queryLayer(0, POINT_FIELDS).then(function(features) {
        return {
            activeStorms: assembleStorms(features, []).map(function(item) {
                return item.storm;
            })
        };
    });
}

function loadStormGraphics() {
    return Promise.all([
        queryLayer(0, POINT_FIELDS),
        queryLayer(4, "STORMNAME,BASIN,STORMNUM,FCSTPRD")
    ]).then(function(parts) {
        return assembleStorms(parts[0], parts[1]);
    });
}

var POINT_FIELDS = "STORMNAME,STORMTYPE,BASIN,STORMNUM,TAU,MAXWIND,MSLP,TCDVLP,DVLBL,SSNUM,TCDIR,TCSPD,DATELBL,VALIDTIME,LAT,LON,ADVISNUM,FCSTPRD";

function queryLayer(layerId, fields) {
    function page(offset, features) {
        var url = HURRICANE_SERVICE + "/" + layerId + "/query?where=1%3D1&outFields=" + fields
            + "&returnGeometry=true&outSR=4326&f=geojson&resultRecordCount=2000&resultOffset=" + offset;
        return fetch(url).then(function(response) {
            if (!response.ok) {
                throw new Error("Storm request failed");
            }
            return response.json();
        }).then(function(data) {
            var batch = data.features || [];
            var next = features.concat(batch);
            var limited = data.exceededTransferLimit || (data.properties && data.properties.exceededTransferLimit);
            if (limited && batch.length) {
                return page(offset + batch.length, next);
            }
            return next;
        });
    }
    return page(0, []);
}

function assembleStorms(pointFeatures, coneFeatures) {
    var groups = {};
    pointFeatures.forEach(function(feature) {
        var props = feature.properties || {};
        var key = stormKey(props);
        if (!key) {
            return;
        }
        if (!groups[key]) {
            groups[key] = [];
        }
        groups[key].push(feature);
    });
    var cones = {};
    coneFeatures.forEach(function(feature) {
        var props = feature.properties || {};
        var key = stormKey(props);
        if (!key) {
            return;
        }
        var period = Number(props.FCSTPRD) || 0;
        if (!cones[key] || period >= cones[key].period) {
            cones[key] = { period: period, feature: feature };
        }
    });
    return Object.keys(groups).map(function(key) {
        return stormRecord(key, groups[key], cones[key]);
    }).filter(function(item) {
        return item && item.storm.latitudeNumeric != null && item.storm.longitudeNumeric != null;
    }).sort(function(a, b) {
        return (Number(b.storm.intensity) || 0) - (Number(a.storm.intensity) || 0);
    }).map(function(item, index) {
        var palette = (typeof STORM_COLORS !== "undefined" && STORM_COLORS) || ["#ffb703", "#ff5d8f", "#48cae4", "#c4f54a", "#c77dff"];
        item.color = palette[index % palette.length];
        return item;
    });
}

function stormRecord(key, features, cone) {
    var points = features.map(function(feature) {
        var props = feature.properties || {};
        var coordinates = feature.geometry && feature.geometry.coordinates;
        return {
            props: props,
            coordinates: coordinates,
            valid: parseValidTime(props.VALIDTIME)
        };
    }).filter(function(point) {
        return point.coordinates && point.coordinates.length >= 2;
    });
    if (!points.length) {
        return null;
    }
    var useTau = points.some(function(point) { return Number(point.props.TAU) > 0; });
    var origin = chooseOrigin(points);
    points.forEach(function(point) {
        point.hour = useTau ? (Number(point.props.TAU) || 0) : hoursFromOrigin(origin, point.valid);
    });
    points.sort(function(a, b) { return a.hour - b.hour; });
    var current = points[0];
    var props = current.props;
    var longitude = Number(current.coordinates[0]);
    var latitude = Number(current.coordinates[1]);
    var pressure = cleanNumber(props.MSLP, function(value) { return value <= 0 || value >= 1100; });
    var direction = cleanNumber(props.TCDIR, function(value) { return value < 0 || value > 360; });
    var speed = cleanNumber(props.TCSPD, function(value) { return value < 0 || value > 200; });
    if (direction === 0 && speed === 0) {
        direction = null;
        speed = null;
    }
    var basin = String(props.BASIN || "").toUpperCase();
    return {
        storm: {
            id: key,
            name: displayName(props.STORMNAME),
            classification: classificationCode(props),
            intensity: cleanNumber(props.MAXWIND, function(value) { return value < 0 || value > 250; }),
            pressure: pressure == null ? "" : String(pressure),
            latitudeNumeric: latitude,
            longitudeNumeric: longitude,
            movementDir: direction,
            movementSpeed: speed,
            publicAdvisory: { url: advisoryUrl(basin) }
        },
        track: trackCollection(points),
        cone: cone ? coneCollection(cone.feature) : null
    };
}

function trackCollection(points) {
    var features = [];
    var splitAt = 0;
    points.forEach(function(point, index) {
        if (point.hour <= 72) {
            splitAt = index;
        }
        if (point.hour <= 0) {
            return;
        }
        var wind = cleanNumber(point.props.MAXWIND, function(value) { return value < 0 || value > 250; });
        features.push({
            type: "Feature",
            geometry: { type: "Point", coordinates: point.coordinates },
            properties: {
                kind: "point",
                hour: point.hour,
                valid: point.props.DATELBL || "",
                wind: wind == null ? "" : windText(wind),
                label: point.hour + "h"
            }
        });
    });
    var coordinates = points.map(function(point) { return point.coordinates; });
    pushTrack(features, coordinates.slice(0, splitAt + 1), 72);
    pushTrack(features, coordinates.slice(splitAt), 120);
    return { type: "FeatureCollection", features: features };
}

function pushTrack(features, coordinates, hours) {
    if (coordinates.length < 2) {
        return;
    }
    features.push({
        type: "Feature",
        geometry: { type: "LineString", coordinates: coordinates },
        properties: { kind: "track", hours: hours }
    });
}

function coneCollection(feature) {
    if (!feature.geometry) {
        return null;
    }
    return {
        type: "FeatureCollection",
        features: [{
            type: "Feature",
            geometry: feature.geometry,
            properties: { kind: "cone" }
        }]
    };
}

function stormKey(props) {
    if (props.STORMNUM == null || props.STORMNUM === "") {
        return "";
    }
    return String(props.BASIN || "").toUpperCase() + "-" + props.STORMNUM;
}

function classificationCode(props) {
    var type = String(props.STORMTYPE || "").trim().toUpperCase();
    if (CLASSIFICATION_LABELS[type]) {
        return type;
    }
    var label = String(props.TCDVLP || "").toLowerCase();
    if (label.indexOf("potential") !== -1) return "PC";
    if (label.indexOf("post-tropical") !== -1 || label.indexOf("post tropical") !== -1) return "PTC";
    if (label.indexOf("subtropical depression") !== -1) return "STD";
    if (label.indexOf("subtropical") !== -1) return "STS";
    if (label.indexOf("depression") !== -1) return "TD";
    if (label.indexOf("typhoon") !== -1) return "TY";
    if (label.indexOf("hurricane") !== -1) return "HU";
    if (label.indexOf("tropical storm") !== -1 || label.indexOf("storm") !== -1) return "TS";
    var mark = String(props.DVLBL || "").toUpperCase();
    if (mark === "H" || mark === "M") return "HU";
    if (mark === "S") return "TS";
    if (mark === "D") return "TD";
    return "TS";
}

function displayName(name) {
    return String(name || "Storm").replace(/-([a-z])/g, function(_, letter) {
        return "-" + letter.toUpperCase();
    });
}

function advisoryUrl(basin) {
    if (basin === "AL" || basin === "EP" || basin === "CP") {
        return "https://www.nhc.noaa.gov/cyclones/";
    }
    if (basin === "WP" || basin === "IO" || basin === "SH") {
        return "https://www.metoc.navy.mil/jtwc/jtwc.html";
    }
    return "https://www.nhc.noaa.gov/";
}

function cleanNumber(value, invalid) {
    var number = Number(value);
    if (!isFinite(number) || number === 9999 || (invalid && invalid(number))) {
        return null;
    }
    return number;
}

function parseValidTime(value) {
    var match = /^(\d{1,2})\/(\d{2})(\d{2})$/.exec(String(value || "").trim());
    if (!match) {
        return null;
    }
    return { day: Number(match[1]), hour: Number(match[2]), minute: Number(match[3]) };
}

function chooseOrigin(points) {
    var valids = points.map(function(point) { return point.valid; }).filter(Boolean);
    var best = valids[0] || null;
    var bestSpan = Infinity;
    valids.forEach(function(candidate) {
        var hours = valids.map(function(valid) { return hoursBetween(candidate, valid); });
        if (hours.some(function(hour) { return hour < 0; })) {
            return;
        }
        var span = Math.max.apply(null, hours);
        if (span < bestSpan) {
            bestSpan = span;
            best = candidate;
        }
    });
    return best;
}

function hoursFromOrigin(origin, valid) {
    var hours = hoursBetween(origin, valid);
    return hours < 0 ? 0 : hours;
}

function hoursBetween(origin, valid) {
    if (!origin || !valid) {
        return 0;
    }
    var dayDiff = valid.day - origin.day;
    if (dayDiff < -15) {
        dayDiff += 31;
    }
    return dayDiff * 24 + (valid.hour - origin.hour);
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
    if (storm.movementDir == null || storm.movementDir === "") {
        return "Movement unavailable";
    }
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
        + "<div><dt>Pressure</dt><dd>" + escapeHtml(storm.pressure ? storm.pressure + " mb" : "—") + "</dd></div>"
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

    loadStormGraphics()
        .then(function(results) {
            if (!results.length) {
                list.innerHTML = "<p class=\"empty-state\">No active storms right now.</p>";
                return null;
            }
            return results;
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
            + "<em>" + escapeHtml(windText(storm.intensity)) + " · " + escapeHtml(storm.pressure ? storm.pressure + " mb" : "—") + "</em>"
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
