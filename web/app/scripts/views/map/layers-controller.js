(function () {
    'use strict';

    /* ngInject */
    function DriverLayersController($q, $log, $scope, $rootScope, $timeout,
                                    WebConfig, FilterState, RecordState, GeographyState,
                                    Records, QueryBuilder, MapState, TileUrlService) {
        var ctl = this;

        ctl.recordType = 'ALL';
        ctl.layerSwitcher = null;
        ctl.drawControl = null;
        ctl.map = null;
        ctl.overlays = null;
        ctl.baseMaps = null;
        ctl.editLayers = null;
        ctl.filterSql = null;

        var cartoDBAttribution = '&copy; <a href="http://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, &copy; <a href="http://cartodb.com/attributions">CartoDB</a>';
        var filterStyle = {
            color: '#f357a1',
            fillColor: '#f357a1',
            fill: true
        };

        /**
         * Initialize layers on map.
         * First calls to get the current selection in the record type drop-down.
         *
         * @param {Object} map Leaflet map returned by leaflet directive initialization.
         */
        ctl.initLayers = function(map) {

            ctl.map = map;

            // get the current record type selection for filtering
            RecordState.getSelected().then(function(selected) {
                if (selected && selected.uuid) {
                    ctl.recordType = selected.uuid;
                } else {
                    ctl.recordType = 'ALL';
                }
            }).then(function () {
                // add base layer
                var baseMaps = $q.defer();
                ctl.baseMaps = baseMaps.promise;
                var streetsOptions = {
                    attribution: cartoDBAttribution,
                    detectRetina: true,
                    zIndex: 1
                };
                TileUrlService.baseLayerUrl().then(function(streetsUrl) {
                    var streets = new L.tileLayer(streetsUrl, streetsOptions);
                    ctl.map.addLayer(streets);

                    baseMaps.resolve({ 'CartoDB Positron': streets });
                });
            }).then(function () {
                // add polygon draw control and layer to edit on
                ctl.editLayers = new L.FeatureGroup();
                ctl.map.addLayer(ctl.editLayers);

                ctl.drawControl = new L.Control.Draw({
                    draw: {
                        // TODO: figure out a good way to export circles.
                        // Calling toGeoJSON on the Leaflet feature layer
                        // returns a point with no radius set in the properties.
                        circle: false,
                        marker: false,
                        polyline: false,
                        polygon: {
                            allowIntersection: false,
                            showArea: true,
                            drawError: {
                                // TODO: pick a custom color to set, or remove option
                                //color: '#e1e100', // Color the shape will turn when intersects
                                message: '<strong>Filter area cannot intersect itself.</strong>'
                            },
                            shapeOptions: {
                                //color: '#bdda55'
                            }
                        }
                    },
                    edit: {
                        featureGroup: ctl.editLayers
                    }
                });

                ctl.map.addControl(ctl.drawControl);

                // handle map draw events
                ctl.map.on('draw:created', function(e) {
                    filterShapeCreated(e.layer);
                });

                ctl.map.on('draw:edited', function(e) {
                    e.layers.eachLayer(function(layer) {
                        filterShapeCreated(layer);
                    });
                });

                // only allow one filter shape at a time
                // TODO: temporarily remove interactivity layer while editing
                ctl.map.on('draw:drawstart', function() {
                    ctl.editLayers.clearLayers();
                    $rootScope.$broadcast('driver.views.map:filterdrawn', null);
                });

                ctl.map.on('draw:deleted', function() {
                    ctl.editLayers.clearLayers();
                    $rootScope.$broadcast('driver.views.map:filterdrawn', null);
                });

                ctl.map.on('zoomend', function() {
                    MapState.setZoom(ctl.map.getZoom());
                });

                ctl.map.on('moveend', function() {
                    MapState.setLocation(ctl.map.getCenter());
                });

                // TODO: Find a better way to ensure this doesn't happen until filterbar ready
                // (without timeout, filterbar components aren't ready to listen yet)
                // add filtered overlays
                // this will trigger `driver.filterbar:changed` when complete
                $timeout(FilterState.restoreFilters, 1000);
            }).then(function() {
                if (MapState.getLocation() && MapState.getZoom()) {
                    ctl.map.setView(MapState.getLocation(), MapState.getZoom());
                }

                if (MapState.getFilterGeoJSON()) {
                    var layer =  L.geoJson(MapState.getFilterGeoJSON());
                    layer.setStyle(filterStyle);
                    ctl.editLayers.addLayer(layer);
                }
            });
        };

        function filterShapeCreated(layer) {
            // TODO: is the shape type useful info?
            //var type = event.layerType;
            ctl.editLayers.clearLayers();

            layer.setStyle(filterStyle);
            ctl.editLayers.addLayer(layer);
            $rootScope.$broadcast('driver.views.map:filterdrawn');

            // Use GeoJSON instead of a normal layer - theres a strange bug likely stemming from
            //  race conditions on the Leaflet Map object otherwise
            MapState.setFilterGeoJSON(layer.toGeoJSON());

            // pan/zoom to selected area

            ctl.map.fitBounds(layer.getBounds());

            // Send exported shape to filterbar, which will send `changed` event with filters.
            var geojson = ctl.editLayers.toGeoJSON();
            $rootScope.$broadcast('driver.views.map:filterdrawn', geojson);

            // TODO: use an interaction event to remove the drawn filter area?
            /*
            layer.on('click', function(e) {
                $log.debug('draw layer clicked!');
                $log.debug(e);
            });
            */
        }

        /**
         * Cast the fields in the SELECT clause to strings, for interactivity to work.
         *
         * @param {String} sql The full query to convert
         * @returns {String} Full query, with the SELECTed fields cast to strings
         */
        function castQueryToStrings(sql) {
            var fromIdx = sql.indexOf(' FROM');
            var select = sql.substr(0, fromIdx);
            var theRest = sql.substr(fromIdx);
            var fields = select.split(', ');

            var geomRegex = /geom/;

            var castSelect = _.map(fields, function(field) {
                if (field.match(geomRegex)) {
                    return field; // do not cast geom field
                } else {
                    return field + '::varchar';
                }
            }).join(', ');

            return castSelect + theRest;
        }

        /**
         * Adds the map layers. Removes them first if they already exist.
         *
         * @param {Object} map Leaflet map returned by leaflet directive initialization.
         */
        ctl.setRecordLayers = function() {

            if (!ctl.map) {
                $log.error('Map controller has no map! Cannot add layers.');
                return;
            }

            $q.all([TileUrlService.recTilesUrl(ctl.recordType),
                    TileUrlService.recUtfGridTilesUrl(ctl.recordType),
                    TileUrlService.recHeatmapUrl(ctl.recordType)]).then(function(tileUrls) {
                var baseRecordsUrl = tileUrls[0];
                var baseUtfGridUrl = tileUrls[1];
                var baseHeatmapUrl = tileUrls[2];
                var defaultLayerOptions = {attribution: 'PRS', detectRetina: true};

                // remove overlays if already added
                if (ctl.overlays) {
                    angular.forEach(ctl.overlays, function(overlay) {
                        ctl.map.removeLayer(overlay);
                    });
                }

                // Event record points. Use 'ALL' or record type UUID to filter layer
                var recordsLayerOptions = angular.extend(defaultLayerOptions, {zIndex: 3});
                var recordsLayer = new L.tileLayer(ctl.addFilterSql(baseRecordsUrl),
                                                   recordsLayerOptions);

                // layer with heatmap of events
                var heatmapOptions = angular.extend(defaultLayerOptions, {zIndex: 4});
                var heatmapLayer = new L.tileLayer(ctl.addFilterSql(baseHeatmapUrl), heatmapOptions);

                // interactivity for record layer
                var utfGridRecordsLayer = new L.UtfGrid(ctl.addFilterSql(baseUtfGridUrl),
                                                        {useJsonP: false, zIndex: 5});

                // combination of records and UTF grid layers, so they can be toggled as a group
                var recordsLayerGroup = new L.layerGroup([recordsLayer, utfGridRecordsLayer]);

                utfGridRecordsLayer.on('click', function(e) {
                    // ignore clicks where there is no event record
                    if (!e.data) {
                        return;
                    }

                    var popupOptions = {
                        maxWidth: 400,
                        maxHeight: 300,
                        autoPan: true,
                        closeButton: true,
                        autoPanPadding: [5, 5]
                    };

                    new L.popup(popupOptions)
                        .setLatLng(e.latlng)
                        .setContent(ctl.buildRecordPopup(e.data))
                        .openOn(ctl.map);
                });
                // TODO: find a reasonable way to get the current layers selected, to add those back
                // when switching record type, so selected layers does not change with filter change.

                // Add layers to show by default.
                // Layers added to map will automatically be selected in the layer switcher.
                ctl.map.addLayer(recordsLayerGroup);

                var recordsOverlays = {
                    'Events': recordsLayerGroup,
                    'Heatmap': heatmapLayer
                };

                // construct user-uploaded boundary layer(s)
                var availableBoundaries = $q.defer();
                GeographyState.getOptions().then(function(boundaries) {
                    var boundaryLayerOptions = angular.extend(defaultLayerOptions, {zIndex: 2});
                    $q.all(boundaries.map(function(boundary) {
                        return TileUrlService.boundaryTilesUrl(boundary.uuid).then(
                            function(baseBoundUrl) {
                                var colorUrl = (baseBoundUrl +
                                    '?color=' +
                                    encodeURIComponent(boundary.color));
                                var layer = new L.tileLayer(colorUrl, boundaryLayerOptions);
                                return [boundary.label, layer];
                            }
                        );
                    })).then(function(boundaryLabelsLayers) { // Array of [label, layer] pairs
                        availableBoundaries.resolve(_.zipObject(boundaryLabelsLayers));
                    });
                });

                // Once boundary layers have been created, add them (along with the other layers
                // created so far) to the map.
                $q.all([availableBoundaries.promise, ctl.baseMaps]).then(function(allOverlays) {
                    var boundaryOverlays = allOverlays[0];
                    var baseMaps = allOverlays[1];
                    ctl.overlays = angular.extend({}, boundaryOverlays, recordsOverlays);

                    // add layer switcher control; expects to have layer zIndex already set

                    // If layer switcher already initialized, must re-initialize it.
                    if (ctl.layerSwitcher) {
                        ctl.layerSwitcher.removeFrom(ctl.map);
                    }
                    ctl.layerSwitcher = L.control.layers(baseMaps, ctl.overlays, {autoZIndex: false});
                    ctl.layerSwitcher.addTo(ctl.map);
                });
            });
        };

        /**
         * Build popup content from arbitrary record data.
         *
         * @param {Object} UTFGrid interactivity data from interaction event object
         * @returns {String} HTML snippet for a Leaflet popup.
         */
        ctl.buildRecordPopup = function(record) {
            // read arbitrary record fields object

            var data = JSON.parse(record.data);
            var startingUnderscoreRegex = /^_/;

            // add header with event date constant field
            /* jshint camelcase: false */
            var str = '<div class="record-popup">';
            str += '<div><h3>Occurred on: ' + record.occurred_from + '</h3>';
            /* jshint camelcase: true */

            // build HTML for popup from the record object
            function strFromObj(obj) {
                angular.forEach(obj, function(value, key) {
                    // Skip _localId hashes, any other presumably private values
                    // starting with an underscore, and their children.
                    // Checking type because some keys are numeric.
                    if (typeof key === 'string' && !key.match(startingUnderscoreRegex)) {
                        if (typeof value === 'object') {
                            str += '<h4>' + key + '</h4><div style="margin:15px;">';
                            // recursively add child things, indented
                            strFromObj(value);
                            str += '</div>';
                        } else {
                            // have a simple value; display it
                            str += '<p>' + key + ': ' + value + '</p>';
                        }
                    }
                });
            }

            strFromObj(data);

            str += '</div></div>';
            return str;
        };


        /**
         * Helper function to add a SQL filter parameter to the windshaft URL
         *
         * @param {String} baseUrl Map layer URL
         * @param {String} sql SQL to append to the request URL
         * @returns {String} The baseUrl with the record type parameter set to the selected type.
         */
        ctl.addFilterSql = function(baseUrl, sql) {
            var url = baseUrl;
            if (sql) {
                // TODO: find a less hacky way to handle building URLs for Windshaft
                url += url.match(/\?/) ? '&sql=' : '?sql=';
                url += encodeURIComponent(sql);
            }
            return url;
        };

        $scope.$on('driver.state.recordstate:selected', function(event, selected) {
            if (ctl.recordType !== selected && selected && selected.uuid) {
                ctl.recordType = selected.uuid;
                // re-add the layers to refresh with filtered content
                ctl.setRecordLayers();
            }
        });

        /**
         * Update map when filters change
         */
        var filterHandler = $rootScope.$on('driver.filterbar:changed', function() {
            // get the raw SQL for the filter to send along to Windshaft
            QueryBuilder.djangoQuery(true, 0, {query: true}).then(function(records) {
                ctl.filterSql = castQueryToStrings(records.query);
                ctl.setRecordLayers();
            });
        });

        // $rootScope listeners must be manually unbound when the $scope is destroyed
        $scope.$on('$destroy', filterHandler);

        return ctl;
    }

    angular.module('driver.views.map')
    .controller('driverLayersController', DriverLayersController);

})();
