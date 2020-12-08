var layer = new ol.layer.Tile({
    source: new ol.source.OSM({
        wrapX: false,
        noWrap: true
    })
});

var map = new ol.Map({
    controls: [],
    layers: [layer],
    target: 'map',
    view: new ol.View({
        center: [0, 2000000000],
        zoom: 0,
        extent: [-20037508.342789244,-8950087.059779197,20037508.342789244,8950087.059779197]
        //extent: [-3757032.814272983,-20037508.342789244,3757032.814272983,20037508.342789244]
        //extent: [-300562.6251418386,-20037508.342789244,300562.6251418386,20037508.342789244]
    }),
    interactions: [],
});

var hurricaneData = {};
function setupHurricaneData() {
    // TODO
}

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






