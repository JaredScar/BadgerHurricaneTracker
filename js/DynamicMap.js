var layer = new ol.layer.Tile({
    source: new ol.source.OSM({
        wrapX: false,
        noWrap: true
    })
});

var map = new ol.Map({
    layers: [layer],
    target: 'map',
    view: new ol.View({
        center: [0, 0],
        zoom: 1,
        extent: [-20037508.342789244,-8950087.059779197,20037508.342789244,8950087.059779197]
        //extent: [-3757032.814272983,-20037508.342789244,3757032.814272983,20037508.342789244]
        //extent: [-300562.6251418386,-20037508.342789244,300562.6251418386,20037508.342789244]
    }),
    interactions: ol.interaction.defaults({
    }),
});

function setupHurricaneData() {
    var url = "https://www.nhc.noaa.gov/productexamples/NHC_JSON_Sample.json";
    const proxyurl = "https://cors-anywhere.herokuapp.com/"; // Free proxy
    var data = null;
    fetch(proxyurl + url) // We use a proxy so we can avoid Access-Control-Allow-Origin problem
        .then(response => response.text())
        .then(function(contents) {
            data = contents;
            console.log(data);
            var obj = JSON.parse(data);
            var count = 1;
            for (var i = 0; i < Object.keys(obj.activeStorms).length; i++) {
                var storm = obj.activeStorms[i];
                var name = storm.name;
                var classification = storm.classification;
                var longitude = storm.longitudeNumeric;
                var latitude = storm.latitudeNumeric;
                var windMPH = storm.intensity;
                var pressure = storm.pressure;
                $('#marker-' + count.toString()).attr('title', "Hurricane " + name);

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
setupHurricaneData();

/** /
var pos = ol.proj.fromLonLat([23.3725, 35.208889]);

var marker = new ol.Overlay({
    position: pos,
    positioning: 'center-center',
    element: document.getElementById('marker'),
    //stopEvent: false
});

console.log("The extent is: " + map.getView().calculateExtent(map.getSize()))

map.addOverlay(marker);
 /**/






