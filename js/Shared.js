function setupHurricaneData() {
    // REAL DATA: https://www.nhc.noaa.gov/CurrentStorms.json
    // SAMPLE DATA: https://www.nhc.noaa.gov/productexamples/NHC_JSON_Sample.json
    var url = "https://www.nhc.noaa.gov/productexamples/NHC_JSON_Sample.json";
    const proxyurl = "https://cors-anywhere.herokuapp.com/"; // Free proxy
    var data = null;
    fetch(proxyurl + url) // We use a proxy so we can avoid Access-Control-Allow-Origin problem
        .then(response => response.text())
        .then(function(contents) {
            data = contents;
            //console.log(data);
            var obj = JSON.parse(data);
            var count = 1;
            for (var i = 0; i < Object.keys(obj.activeStorms).length; i++) {
                var storm = obj.activeStorms[i];
                var name = storm.name;
                var classification = storm.classification;
                /**
                 * SOURCE: https://nws.weather.gov/products/PDD/PDD_ExpTropicalCycloneJSONFile_2019.pdf
                 *
                 * Classifications:
                 * TD = Tropical Depression
                 * STD = Subtropical Depression
                 * TS = Tropical Storm
                 * HU = Hurricane
                 * STS = Subtropical Storm
                 * PTC = Post-tropical Cyclone / Remnants
                 * TY = Typhoon [ NOT USED ]
                 * PC = Potential Tropical Cyclone
                 */
                classification = classification.toString()
                    .replace("STD", "Subtropical Depression ")
                    .replace("TD", "Tropical Depression ")
                    .replace("STS", "Subtropical Storm ")
                    .replace("TS", "Tropical Storm ")
                    .replace("HU", "Hurricane ")
                    .replace("PTC", "Post-tropical Cyclone ")
                    .replace("PC", "POTENTIAL Tropical Cyclone ");
                var longitude = storm.longitudeNumeric;
                var latitude = storm.latitudeNumeric;
                var windMPH = storm.intensity;
                var pressure = storm.pressure;
                $('#marker-' + count.toString()).attr('title', "Hurricane " + name);

                $('#marker-' + count.toString() + " span").html(
                    '<p>' + classification + "<b style='font-weight: bold;'>" + name + "</b>" + '</p><br />'
                    + '<p>Wind Speeds: <b style="font-weight: bold;">' + windMPH + " MPH</b></p><br />"
                    + '<p>Storm Pressure: <b style="font-weight: bold;">' + pressure + ' mbar</b></p>'
                );
                var pos = ol.proj.fromLonLat([longitude, latitude]);
                var marker = new ol.Overlay({
                    position: pos,
                    positioning: 'center-center',
                    element: document.getElementById('marker-' + count.toString()),
                    //stopEvent: false
                });
                map.addOverlay(marker);
                count++;
            }
        })
        .catch(() => console.log("Can’t access " + url + " response. Blocked by browser?"))
}

function setupHurricaneNews() {
    // REAL DATA: https://www.nhc.noaa.gov/CurrentStorms.json
    // SAMPLE DATA: https://www.nhc.noaa.gov/productexamples/NHC_JSON_Sample.json
    var url = "https://www.nhc.noaa.gov/productexamples/NHC_JSON_Sample.json";
    const proxyurl = "https://cors-anywhere.herokuapp.com/"; // Free proxy
    var data = null;
    var toAppend = "";
    fetch(proxyurl + url) // We use a proxy so we can avoid Access-Control-Allow-Origin problem
        .then(response => response.text())
        .then(function(contents) {
            data = contents;
            //console.log(data);
            var obj = JSON.parse(data);
            var count = 1;
            for (var i = 0; i < Object.keys(obj.activeStorms).length; i++) {
                var storm = obj.activeStorms[i];
                var name = storm.name;
                var classification = storm.classification;
                var direction = getCardinalDirection(storm.movementDir);
                var classificationName = classification.toString()
                    .replace("STD", "Subtropical Depression ")
                    .replace("TD", "Tropical Depression ")
                    .replace("STS", "Subtropical Storm ")
                    .replace("TS", "Tropical Storm ")
                    .replace("HU", "Hurricane ")
                    .replace("PTC", "Post-tropical Cyclone ")
                    .replace("PC", "POTENTIAL Tropical Cyclone ");
                var longitude = storm.longitudeNumeric;
                var latitude = storm.latitudeNumeric;
                var windMPH = storm.intensity;
                var pressure = storm.pressure;
                toAppend += '<div>' + '<span class="blip ' + classification + '"></span> '
                    + classificationName + '<b style="font-weight: bold;">' + name + "</b> has been reported " +
                    "to be moving " + direction + ' with a wind speed of <b style="font-weight: bold;">' + windMPH + " MPH</b></div>";

                count++;
            }
            $('#news').append(toAppend);
        })
        .catch(() => console.log("Can’t access " + url + " response. Blocked by browser?"))
}

function getCardinalDirection(degree) {
     if (degree >= 0 && degree <= 44) return "North";
    if (degree >= 45 && degree <= 89) return "North East";
    if (degree >= 90 && degree <= 134) return "East";
    if (degree >= 135 && degree <= 179) return "South East";
    if (degree >= 180 && degree <= 224) return "South";
    if (degree >= 225 && degree <= 269) return "South West";
    if (degree >= 270 && degree <= 314) return "West";
    return "North West";
}