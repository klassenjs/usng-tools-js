/*
 * Library to convert between NAD83 Lat/Lon and US National Grid
 * Maintained at https://github.com/klassenjs/usng_tools
 *
 * License:
 *
 * Copyright (c) 2008-2022 James Klassen
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the 'Software'), to
 * deal in the Software without restriction, including without limitation the
 * rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
 * sell copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies of this Software or works derived from this Software.
 *
 * THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE.
 */

/* TODO: Norway and others odd grid
 *       UTM as hash instead of function?
 *       More tolerant of extended zones in UPS zones?
 *       Return box instead of point?
 *       Return list of coordinates w/distances for truncated search as well as best.
 *       Internalize UPS projection (remove proj4js dependency).
 *
 */

module.exports = function USNG3() {

    /*eslint-disable*/
    // Note: grid locations are the SW corner of the grid square (because easting and northing are always positive)
    //                   0   1   2   3   4   5   6   7   8   9  10  11  12  13  14  15  16  17  18  19   x 100,000m northing
    var NSLetters135 = ['A','B','C','D','E','F','G','H','J','K','L','M','N','P','Q','R','S','T','U','V'];
    var NSLetters246 = ['F','G','H','J','K','L','M','N','P','Q','R','S','T','U','V','A','B','C','D','E'];

    //                  1   2   3   4   5   6   7   8   x 100,000m easting
    var EWLetters14 = ['A','B','C','D','E','F','G','H'];
    var EWLetters25 = ['J','K','L','M','N','P','Q','R'];
    var EWLetters36 = ['S','T','U','V','W','X','Y','Z'];

    //                  -80  -72  -64  -56  -48  -40  -32  -24  -16  -8    0    8   16   24   32   40   48   56   64   72   (*Latitude)
    //                                                                                                 Handle oddball zone 80-84
    var GridZones    = ['C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'M', 'N', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'X'];
    var GridZonesDeg = [-80, -72, -64, -56, -48, -40, -32, -24, -16, -8,   0,   8,  16,  24,  32,  40,  48,  58,  64,  72,  80];

    // TODO: This is approximate and actually depends on longitude too.
    var GridZonesNorthing = new Array(20);
    for(var i = 0 ; i < 20; i++) {
        GridZonesNorthing[i] = 110946.259 * GridZonesDeg[i]; // == 2 * PI * 6356752.3 * (latitude / 360.0)
    }

    // Grid Letters for UPS
    //                 0    1    2    3    4    5    6    7    8    9   10   11   12   13   14   15   16   17
    var XLetters  = [ 'A', 'B', 'C', 'F', 'G', 'H', 'J', 'K', 'L', 'P', 'Q', 'R', 'S', 'T', 'U', 'X', 'Y', 'Z' ];
    var YNLetters = [ 'H', 'J', 'K', 'L', 'M', 'N', 'P', 'A', 'B', 'C', 'D', 'E', 'F', 'G' ];
    var YSLetters = [ 'N', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
                      'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'M' ];
    /*eslint-enable*/

    var utm_proj = require("./usng-utm.js");
    var Proj4js  = require("proj4");

    // Use Proj4JS for Universal Polar Stereographic.
    var north_proj = '+proj=stere +lat_0=90 +lat_ts=90 +lon_0=0 +k=0.994 +x_0=2000000 +y_0=2000000 +ellps=WGS84 +datum=WGS84 +units=m +no_defs';
    var south_proj = '+proj=stere +lat_0=-90 +lat_ts=-90 +lon_0=0 +k=0.994 +x_0=2000000 +y_0=2000000 +ellps=WGS84 +datum=WGS84 +units=m +no_defs';
    var ll_proj    = 'EPSG:4326';

    // http://en.wikipedia.org/wiki/Great-circle_distance
    // http://en.wikipedia.org/wiki/Vincenty%27s_formulae
    function llDistance(ll_start, ll_end)
    {
        var lat_s = ll_start.lat * Math.PI / 180;
        var lat_f = ll_end.lat * Math.PI / 180;
        var d_lon = (ll_end.lon - ll_start.lon) * Math.PI / 180;
        return( Math.atan2(
            Math.sqrt(Math.pow(Math.cos(lat_f) * Math.sin(d_lon), 2) + Math.pow(Math.cos(lat_s) * Math.sin(lat_f) - Math.sin(lat_s) * Math.cos(lat_f) * Math.cos(d_lon), 2)),
            Math.sin(lat_s) * Math.sin(lat_f) + Math.cos(lat_s) * Math.cos(lat_f) * Math.cos(d_lon))
        );
    }

    /* Returns a USNG String for a UTM point, and zone id's, and precision
     * utm_zone => 15 ; grid_zone => 'T' (calculated from latitude);
     * utm_easting => 491000, utm_northing => 49786000; precision => 2
     */
    function fromUTM(utm_zone, grid_zone, utm_easting, utm_northing, precision) {
        var utm_zone;
        var grid_zone;
        var grid_square;
        var grid_easting;
        var grid_northing;
        var precision;

        var grid_square_set = utm_zone % 6;

        var ew_idx = Math.floor(utm_easting / 100000) - 1; // should be [100000, 900000]
        var ns_idx = Math.floor((utm_northing % 2000000) / 100000); // should [0, 10000000) => [0, 2000000)
        if(ns_idx < 0) { /* handle southern hemisphere */
            ns_idx += 20;
        }
        switch(grid_square_set) {
        case 1:
            grid_square = EWLetters14[ew_idx] + NSLetters135[ns_idx];
            break;
        case 2:
            grid_square = EWLetters25[ew_idx] + NSLetters246[ns_idx];
            break;
        case 3:
            grid_square = EWLetters36[ew_idx] + NSLetters135[ns_idx];
            break;
        case 4:
            grid_square = EWLetters14[ew_idx] + NSLetters246[ns_idx];
            break;
        case 5:
            grid_square = EWLetters25[ew_idx] + NSLetters135[ns_idx];
            break;
        case 0: // Calculates as zero, but is technically 6 */
            grid_square = EWLetters36[ew_idx] + NSLetters246[ns_idx];
            break;
        default:
            throw("USNG: can't get here");
        }


        // Calc Easting and Northing integer to 100,000s place
        var easting  = Math.floor(utm_easting % 100000).toString();
        var northing = Math.floor(utm_northing % 100000);
        if(northing < 0) {
            northing += 100000;
        }
        northing = northing.toString();

        // Pad up to meter precision (5 digits)
        while(easting.length < 5) { easting = '0' + easting; }
        while(northing.length < 5) { northing = '0' + northing; }

        if(precision > 5) {
            // Calculate the fractional meter parts
            var digits = precision - 5;
            grid_easting  = easting + (utm_easting % 1).toFixed(digits).substr(2, digits);
            grid_northing = northing + (utm_northing % 1).toFixed(digits).substr(2, digits);
        } else {
            // Remove unnecessary digits
            grid_easting  = easting.substr(0, precision);
            grid_northing = northing.substr(0, precision);
        }

        var usng_string = String(utm_zone) + grid_zone + " " + grid_square + " " + grid_easting + " " + grid_northing;
        return(usng_string);
    }

    // Calculate UTM easting and northing from full, parsed USNG coordinate
    function toUTMFromFullParsedUSNG(utm_zone, grid_zone, grid_square, grid_easting, grid_northing, precision, strict)
    {
        var utm_easting = 0;
        var utm_northing = 0;

        utm_zone = +utm_zone;
        var grid_square_set = utm_zone % 6;
        var ns_grid;
        var ew_grid;
        switch(grid_square_set) {
        case 1:
            ns_grid = NSLetters135;
            ew_grid = EWLetters14;
            break;
        case 2:
            ns_grid = NSLetters246;
            ew_grid = EWLetters25;
            break;
        case 3:
            ns_grid = NSLetters135;
            ew_grid = EWLetters36;
            break;
        case 4:
            ns_grid = NSLetters246;
            ew_grid = EWLetters14;
            break;
        case 5:
            ns_grid = NSLetters135;
            ew_grid = EWLetters25;
            break;
        case 0: // grid_square_set will == 0, but it is technically group 6
            ns_grid = NSLetters246;
            ew_grid = EWLetters36;
            break;
        default:
            throw("Can't get here");
        }
        var ew_idx = ew_grid.indexOf(grid_square[0]);
        var ns_idx = ns_grid.indexOf(grid_square[1]);

        if(ew_idx === -1 || ns_idx === -1) {
            throw("USNG: Invalid USNG 100km grid designator for UTM zone " + utm_zone + ".");
            // throw(RangeError("USNG: Invalid USNG 100km grid designator."));
        }

        utm_easting = ((ew_idx + 1) * 100000) + grid_easting; // Should be [100,000, 900,000]
        utm_northing = ((ns_idx + 0) * 100000) + grid_northing; // Should be [0, 2,000,000)

        // TODO: this really depends on easting too...
        // At this point know UTM zone, Grid Zone (min latitude), and easting
        // Right now this is look up table returns a max number based on lon == utm zone center
        var min_northing = GridZonesNorthing[GridZones.indexOf(grid_zone)]; // Unwrap northing to ~ [0, 10000000]
        utm_northing += 2000000 * Math.ceil((min_northing - utm_northing) / 2000000);

        // Check that the coordinate is within the utm zone and grid zone specified:
        var ll = utm_proj.invProj(utm_zone, utm_easting, utm_northing);
        var ll_utm_zone = Math.floor((ll.lon - (-180.0)) / 6.0) + 1;
        var ll_grid_zone = GridZones[Math.floor((ll.lat - (-80.0)) / 8)];

        // If error from the above TODO mattered... then need to move north a grid
        if( ll_grid_zone !== grid_zone) {
            utm_northing -= 2000000;
            ll = utm_proj.invProj(utm_zone, utm_easting, utm_northing);
            ll_utm_zone = Math.floor((ll.lon - (-180.0)) / 6.0) + 1;
            ll_grid_zone = GridZones[Math.floor((ll.lat - (-80.0)) / 8)];
        }

        if(strict) {
            if(ll.lat > 84.0 || ll.lat < -80.0) {
                throw("USNG: Latitude " + ll.lat + " outside valid UTM range.");
            }
            if(ll_utm_zone !== utm_zone) {
                throw("USNG: calculated coordinate not in correct UTM zone! Supplied: " +
                      utm_zone + " Calculated: " + ll_utm_zone);
            }
            if(ll_grid_zone !== grid_zone) {
                throw("USNG: calculated coordinate not in correct grid zone! Supplied: " +
                      utm_zone + grid_zone + " Calculated: " + ll_utm_zone + ll_grid_zone);
            }
        } else {
            // Loosen requirements to allow for grid extensions that don't introduce ambiguity.

            // "The UTM grid extends to 80°30'S and 84°30'N, providing a 30-minute overlap with the UPS grid."
            // -- http://earth-info.nga.mil/GandG/publications/tm8358.1/tr83581b.html Section 2-6.3.1
            if(ll.lat > 84.5 || ll.lat < -79.5) {
                throw("USNG: Latitude " + ll.lat + " outside valid UTM range.");
            }
            // 100km grids E-W unique +/- 2 UTM zones of the correct UTM zone.
            // 100km grids unique for 800,000m in one UTM zone.
            // Thus, two limiting conditions for uniqueness:
            //      UTM zone max width = 665,667m at equator => 800,000m is 1.2 UTM 6* zones wide at 0*N. => 67000m outside zone.
            //          => utm_easting in [100,000, 900,000] (800,000m wide centered at 500,000m (false easting)
            //      UTM zone min width = 63,801m at 84.5* N. => 12 UTM 6* zones.  => 2 UTM zones.
            if(utm_easting < 100000 || utm_easting > 900000) {
                throw("USNG: calculated coordinate not in correct UTM zone! Supplied: " +
                      utm_zone + grid_zone + " Calculated: " + ll_utm_zone + ll_grid_zone);
            }
            var utm_zone_diff = Math.abs(ll_utm_zone - utm_zone);
            if(utm_zone_diff > 2 && utm_zone_diff < 58) { // utm_zone wraps 1..60,1
                throw("USNG: calculated coordinate not in correct UTM zone! Supplied: " +
                      utm_zone + grid_zone + " Calculated: " + ll_utm_zone + ll_grid_zone);
            }
            // 100km grids N-S unique +/- 2,000,000 meters
            // A grid zone is roughly 887,570 meters N-S
            // => unique +/- 1 grid zone.
            var ll_idx = NSLetters135.indexOf(ll_grid_zone); // 135 or 246 doesn't matter
            var gz_idx = NSLetters135.indexOf(grid_zone);    // letters in same order and circular subtraction.
            var gz_diff  = Math.abs(ll_idx - gz_idx);
            if(gz_diff > 1 && gz_diff < 19) {
                throw("USNG: calculated coordinate not in correct grid zone! Supplied: " +
                      utm_zone + grid_zone + " Calculated: " + ll_utm_zone + ll_grid_zone);
            }
        }

        var usng_string = String(utm_zone) + grid_zone + " " + grid_square + " " + grid_easting + " " + grid_northing;
        return { zone: utm_zone, easting: utm_easting, northing: utm_northing, precision: precision, usng: usng_string };
    }

    /* Method to convert a USNG coordinate string into a NAD83/WGS84 LonLat Point
     * First parameter: usng = A valid USNG coordinate string (possibly truncated)
     *  Possible cases:
     *      Full USNG: 14TPU3467
     *      Truncated:   TPU3467
     *      Truncated:    PU3467
     *      Truncated:      3467
     *      Truncated: 14TPU
     *      Truncated: 14T
     *      Truncated:    PU
     * Second parameter: a LonLat point to use to disambiguate a truncated USNG point
     * Returns: The LonLat point
     */
    function toUTM(usng, initial_lonlat, strict) {
        // Parse USNG into component parts
        var easting = 0;
        var northing = 0;
        var precision = 0;

        var digits = ""; /* don't really need this if using call to parsed... */
        var grid_square = null;
        var grid_zone = null;
        var utm_zone = null;

        // Remove Whitespace (shouldn't be any)
        usng = usng.replace(/ /g, "").toUpperCase();

        // Strip Coordinate values off of end, if any
        // This will be any trailing digits.
        re = new RegExp("([0-9]+)$");
        fields = re.exec(usng);
        if(fields) {
            digits = fields[0];
            precision = digits.length / 2; // TODO: throw an error if #digits is odd.
            var scale_factor = Math.pow(10, (5 - precision)); // 1 digit => 10k place, 2 digits => 1k ...
            easting = Number(digits.substr(0, precision)) * scale_factor;
            northing = Number(digits.substr(precision, precision)) * scale_factor;
        }
        usng = usng.substr(0, usng.length - (precision * 2));

        // Get 100km Grid Designator, if any
        var re = new RegExp("([A-Z][A-Z]$)");
        var fields = re.exec(usng);
        if(fields) {
            grid_square = fields[0];
        }
        usng = usng.substr(0, usng.length - 2);

        // Get UTM and Grid Zone
        re = new RegExp("([0-9]+)([A-Z])");
        fields = re.exec(usng);
        if(fields) {
            utm_zone = fields[1];
            grid_zone = fields[2];
        }
        // Allow the number-less A,B,Y,Z UPS grid zones
        if(!utm_zone) {
            re = new RegExp("([A-Z])");
            fields = re.exec(usng);
            if(fields) {
                grid_zone = fields[1];
            }
        }

        // Use lonlat Point as approx Location to fill in missing prefix info
        // Note: actual prefix need not be the same as that of the llPoint (we could cross 100km grid squares, utm zones, etc.)
        // Our job is to find the closest point to the llPoint given what we know about the USNG point.

        // Calculate the UTM zone, easting and northing from what we know

        /* Method: we can only guess missing prefix information so our cases are:
         * We have everything (14TPU)
         * We are missing the UTM zone (PU)
         * We are missing the UTM zone and the grid designator
         * TODO: Need to throw an exception if utm_zone and no grid_zone as invalid
         * TODO: Also need to throw an exception if don't have at least one of grid_zone and coordinate...maybe
         * TODO: Error if grid_zone is not in GridZones
         */

        if(utm_zone && grid_zone && grid_square) {
            ; // We have everything so there is nothing more to do, UTM.
        } else if((grid_zone === "A" || grid_zone === "B" || grid_zone === "Y" || grid_zone === "Z") && grid_square) {
            ; // We have everything so there is nothing more to do, UPS.
        } else if(grid_square && initial_lonlat) {
            // We need to find the utm_zone and grid_zone
            // We know the grid zone so first we need to find the closest matching grid zone
            // to the initial point. Then add in the easting and northing (if any).

            // Linear search all possible points (TODO: try to put likely guesses near top of list)
            var min_arc_distance = 1000;
            var min_utm_zone  = null;
            var min_grid_zone = null;

            var ll_utm_zone = Math.floor((initial_lonlat.lon - (-180.0)) / 6.0) + 1;
            var ll_grid_zone_idx = Math.floor((initial_lonlat.lat - (-80.0)) / 8);

            // Check the min ranges that need to be searched based on the spec.
            // Need to wrap UTM zones mod 60
            for(utm_zone = ll_utm_zone - 1; utm_zone <= ll_utm_zone + 1; utm_zone++) { // still true at 80*?
                for(var grid_zone_idx = 0; grid_zone_idx < 20; grid_zone_idx++) {
                    grid_zone = GridZones[grid_zone_idx];
                    try {
                        var trial_usng = (utm_zone % 60) + grid_zone + grid_square + digits;
                        var result = toLonLat(trial_usng, null, true); // usng should be [A-Z][A-Z][0-9]+
                        var arc_distance = llDistance(initial_lonlat, result);
                        // console.log(utm_zone + grid_zone + grid_square + digits + " " + arc_distance);
                        if(arc_distance < min_arc_distance) {
                            min_arc_distance = arc_distance;
                            min_utm_zone = utm_zone % 60;
                            min_grid_zone = grid_zone;
                        }
                    } catch(e) {
                        ; // console.log("USNG: upstream: " + e + " for trial " + trial_usng); // catch range errors and ignore
                    }
                }
            }
            // Search UPS zones
            var ups_zones;
            if(initial_lonlat.lat > 0) {
                ups_zones = ['Y', 'Z'];
            } else {
                ups_zones = ['A', 'B'];
            }
            for(var grid_zone_idx in ups_zones) {
                grid_zone = ups_zones[grid_zone_idx];
                try {
                    var result = toLonLat(grid_zone + grid_square + digits, null, true); // usng should be [A-Z][A-Z][0-9]+

                    var arc_distance = llDistance(initial_lonlat, result);
                    // console.log(grid_zone + grid_square + digits + " " + arc_distance);
                    if(arc_distance < min_arc_distance) {
                        min_arc_distance = arc_distance;
                        min_utm_zone = null;
                        min_grid_zone = grid_zone;
                    }
                } catch(e) {
                    ; // console.log("USNG: upstream: "+e); // catch range errors and ignore
                }
            }

            if(min_grid_zone) {
                utm_zone = min_utm_zone;
                grid_zone = min_grid_zone;
            } else {
                throw("USNG: Couldn't find a match");
            }
        } else if(initial_lonlat) {
            // We need to find the utm_zone, grid_zone and 100km grid designator
            // Find the closest grid zone within the specified easting and northing
            // Note: may cross UTM zone boundaries!
            // Linear search all possible points (TODO: try to put likely guesses near top of list)
            var min_arc_distance = 1000;
            var min_utm_zone  = null;
            var min_grid_zone = null;
            var min_grid_square = null;

            var ll_utm_zone = Math.floor((initial_lonlat.lon - (-180.0)) / 6.0) + 1;
            var ll_grid_zone_idx = Math.floor((initial_lonlat.lat - (-80.0)) / 8);

            // Check the min ranges that need to be searched based on the spec.
            for(utm_zone = ll_utm_zone - 1; utm_zone <= ll_utm_zone + 1; utm_zone++) { // still true at 80*?
                for(var grid_zone_idx = ll_grid_zone_idx - 1; grid_zone_idx <= ll_grid_zone_idx + 1; grid_zone_idx++) {
                    grid_zone = GridZones[grid_zone_idx];
                    var grid_square_set = utm_zone % 6;
                    var ns_grid;
                    var ew_grid;
                    switch(grid_square_set) {
                    case 1:
                        ns_grid = NSLetters135;
                        ew_grid = EWLetters14;
                        break;
                    case 2:
                        ns_grid = NSLetters246;
                        ew_grid = EWLetters25;
                        break;
                    case 3:
                        ns_grid = NSLetters135;
                        ew_grid = EWLetters36;
                        break;
                    case 4:
                        ns_grid = NSLetters246;
                        ew_grid = EWLetters14;
                        break;
                    case 5:
                        ns_grid = NSLetters135;
                        ew_grid = EWLetters25;
                        break;
                        // grid_square_set will == 0, but it is technically group 6
                    case 0:
                        ns_grid = NSLetters246;
                        ew_grid = EWLetters36;
                        break;
                    default:
                        throw("Can't get here");
                    }
                    // console.log(utm_zone + grid_zone);
                    for(var ns_idx = 0; ns_idx < 20; ns_idx++) {
                        for(var ew_idx = 0; ew_idx < 8; ew_idx++) {
                            try {
                                grid_square = ew_grid[ew_idx] + ns_grid[ns_idx];

                                // usng should be [A-Z][A-Z][0-9]+
                                var result = toLonLat((utm_zone % 60) + grid_zone + grid_square + digits, null, true);

                                var arc_distance = llDistance(initial_lonlat, result);
                                // console.log(utm_zone + grid_zone + grid_square + digits + " " + arc_distance);
                                if(arc_distance < min_arc_distance) {
                                    min_arc_distance = arc_distance;
                                    min_utm_zone = utm_zone % 60;
                                    min_grid_zone = grid_zone;
                                    min_grid_square = grid_square;
                                }
                            } catch(e) {
                                ;
                                // console.log("USNG: upstream: "+e); // catch range errors and ignore
                            }
                        }
                    }
                }
            }
            // Search UPS zones
            var ups_zones;
            var y_zones;
            var y_max;
            if(initial_lonlat.lat > 0) {
                ups_zones = ['Y', 'Z'];
                y_zones = YNLetters;
                y_max = 14;
            } else {
                ups_zones = ['A', 'B'];
                y_zones = YSLetters;
                y_max = 24;
            }
            for(var grid_zone_idx in ups_zones) {
                grid_zone = ups_zones[grid_zone_idx];

                for(var y_idx = 0; y_idx < y_max; y_idx++) {
                    for(var x_idx = 0; x_idx < 18; x_idx++) {
                        try {
                            grid_square = XLetters[x_idx] + y_zones[y_idx];

                            // usng should be [A-Z][A-Z][0-9]+
                            var result = toLonLat(grid_zone + grid_square + digits, null, true);

                            var arc_distance = llDistance(initial_lonlat, result);
                            // console.log(grid_zone + grid_square + digits + " " + arc_distance);
                            if(arc_distance < min_arc_distance) {
                                min_arc_distance = arc_distance;
                                min_utm_zone = null;
                                min_grid_zone = grid_zone;
                                min_grid_square = grid_square;
                            }
                        } catch(e) {
                            ;
                            // console.log("USNG: upstream: "+e); // catch range errors and ignore
                        }
                    }
                }
            }

            if(min_grid_zone) {
                utm_zone = min_utm_zone;
                grid_zone = min_grid_zone;
                grid_square = min_grid_square;
            } else {
                throw("USNG: Couldn't find a match");
            }

        } else {
            throw("USNG: Not enough information to locate point.");
        }

        if(grid_zone === "A" || grid_zone === "B" || grid_zone === "Y" || grid_zone === "Z") {
            return(toUPSFromFullParsedUSNG(grid_zone, grid_square, easting, northing, precision));
        } else {
            return(toUTMFromFullParsedUSNG(utm_zone, grid_zone, grid_square, easting, northing, precision, strict));
        }
    }


    function fromUPS(grid_zone, ups_x, ups_y, precision)
    {
        if(! ((grid_zone === "A") || (grid_zone === "B") || (grid_zone === "Y") || (grid_zone === "Z"))) {
            throw( "UPS only valid in zones A, B, Y, and Z" );
        }

        var grid_square;

        var grid_square_x_idx = Math.floor((ups_x - 2000000) / 100000);
        var grid_square_y_idx = Math.floor((ups_y - 2000000) / 100000);

        if(grid_square_x_idx < 0) {
            grid_square_x_idx += 18;
        }

        // south
        if(grid_zone === "A" || grid_zone === "B") {
            if(grid_square_y_idx < 0) {
                grid_square_y_idx += 24;
            }
            grid_square = XLetters[grid_square_x_idx] + YSLetters[grid_square_y_idx];
            // north
        } else {
            if(grid_square_y_idx < 0) {
                grid_square_y_idx += 14;
            }

            grid_square = XLetters[grid_square_x_idx] + YNLetters[grid_square_y_idx];
        }

        // Calc X and Y integer to 100,000s place
        var x = Math.floor(ups_x % 100000).toString();
        var y = Math.floor(ups_y % 100000).toString();

        // Pad up to meter precision (5 digits)
        while (x.length < 5) { x = '0' + x; }
        while (y.length < 5) { y = '0' + y; }

        if(precision > 5) {
            // Calculate the fractional meter parts
            var digits = precision - 5;
            grid_x  = x + (ups_x % 1).toFixed(digits).substr(2, digits);
            grid_y = y + (ups_y % 1).toFixed(digits).substr(2, digits);
        } else {
            // Remove unnecessary digits
            grid_x  = x.substr(0, precision);
            grid_y = y.substr(0, precision);
        }

        return grid_zone + " " + grid_square + " " + grid_x + " " + grid_y;
    }


    function toUPSFromFullParsedUSNG(grid_zone, grid_square, grid_x, grid_y, precision)
    {
        if(!Proj4js) {
            throw("USNG: Zones A,B,Y, and Z require Proj4js.");
        }

        /* Start at the pole */
        var ups_x = 2000000;
        var ups_y = 2000000;

        /* Offset based on 100km grid square */
        var x_idx = XLetters.indexOf(grid_square[0]);
        if(x_idx < 0) {
            throw("USNG: Invalid grid square.");
        }
        var y_idx;
        switch(grid_zone) {
            // South West half-hemisphere
        case 'A':
            x_idx = x_idx - 18;
            // South East half-hemisphere
        case 'B':
            y_idx = YSLetters.indexOf(grid_square[1]);
            if(x_idx < -12 || x_idx > 11 || y_idx < 0) {
                throw("USNG: Invalid grid square.");
            }
            if(y_idx > 11) {
                y_idx = y_idx - 24;
            }
            break;

            // North West half-hemisphere
        case 'Y':
            x_idx = x_idx - 18;
            // North East half-hemisphere
        case 'Z':
            y_idx = YNLetters.indexOf(grid_square[1]);
            if(x_idx < -7 || x_idx > 6 || y_idx < 0) {
                throw("USNG: Invalid grid square.");
            }
            if(y_idx > 6) {
                y_idx = y_idx - 14;
            }
            break;

        default:
            throw("UPS only valid in zones A, B, Y, and Z");
        };

        ups_x += x_idx * 100000;
        ups_y += y_idx * 100000;

        /* Offset based on grid_x,y */
        ups_x += grid_x;
        ups_y += grid_y;

        // Check that the coordinate is within the ups zone and grid zone specified:
        var ups = { x: ups_x, y: ups_y };
        if(grid_zone === "A" || grid_zone === "B") {
            ll = Proj4js(south_proj, ll_proj, ups);
            if(ll.y > -80.0) {
                throw("USNG: Grid Zone A or B but Latitude > -80.");
            }
        } else {
            ll = Proj4js(north_proj, ll_proj, ups);
            if(ll.y < 84.0) {
                throw("USNG: Grid Zone Y or Z but Latitude < 84.");
            }
        }

        var usng_string = grid_zone + " " + grid_square + " " + grid_x + " " + grid_y;
        return { grid_zone: grid_zone, x: ups_x, y: ups_y, precision: precision, usng: usng_string };
    }

    // Converts a lat, lon point (NAD83) into a USNG coordinate string
    // of precision where precision indicates the number of digits used
    // per coordinate (0 = 100,000m, 1 = 10km, 2 = 1km, 3 = 100m, 4 = 10m, ...)
    this.fromLonLat = function(lonlat, precision) {
        var lon = lonlat.lon;
        var lat = lonlat.lat;

        // Normalize Longitude (-180, 180]
        while(lon <= -180) {
            lon += 360;
        }
        while(lon > 180) {
            lon -= 360;
        }

        // Calculate UTM Zone number from Longitude
        // -180 = 180W is grid 1... increment every 6 degrees going east
        // Note [-180, -174) is in grid 1, [-174,-168) is 2, [174, 180) is 60
        var utm_zone = Math.floor((lon - (-180.0)) / 6.0) + 1;

        // Calculate USNG Grid Zone Designation from Latitude
        // Starts at -80 degrees and is in 8 degree increments
        if(! ((lat > -80) && (lat < 84) )) {
            var grid_zone;
            var ll = {x: lon, y: lat};
            var ups_pt;

            if( lat > 0 ) {
                ups_pt = Proj4js( ll_proj, north_proj, ll );
                grid_zone = (lon < 0) ? "Y" : "Z";
            } else {
                ups_pt = Proj4js( ll_proj, south_proj, ll );
                grid_zone = (lon < 0) ? "A" : "B";
            }
            return fromUPS(grid_zone, ups_pt.x, ups_pt.y, precision);
        }

        var grid_zone = GridZones[Math.floor((lat - (-80.0)) / 8)];
        var utm_pt = utm_proj.proj(utm_zone, lon, lat);

        return fromUTM(utm_zone, grid_zone, utm_pt.utm_easting, utm_pt.utm_northing, precision);
    }

    function toLonLat(usng, initial_lonlat, strict)
    {
        var result = toUTM(usng, initial_lonlat, strict);
        var grid_zone = result.grid_zone;
        var ll;

        if(south_proj && (grid_zone === "A" || grid_zone === "B")) {
            var pt = {x: result.x, y: result.y};
            pt = Proj4js( south_proj, ll_proj, pt );
            ll = { lon: pt.x, lat: pt.y, precision: result.precision, usng: result.usng };
        } else if(north_proj && (grid_zone === "Y" || grid_zone === "Z")) {
            var pt = {x: result.x, y: result.y};
            pt = Proj4js( north_proj, ll_proj, pt );
            ll = { lon: pt.x, lat: pt.y, precision: result.precision, usng: result.usng };
        } else {
            ll = utm_proj.invProj(result.zone, result.easting, result.northing);
            ll.precision = result.precision;
            ll.usng = result.usng;
        }
        return (ll);
    }

    this.toLonLat = toLonLat;


    this.toSquare = function(usng, initial_lonlat)
    {
        var sw_utm = toUTM(usng, initial_lonlat, false);
        var scale_factor = Math.pow(10, (5 - sw_utm.precision));

        // Note: only works with UTM for now!
        // UTM: { zone: utm_zone, easting: utm_easting, northing: utm_northing, precision: precision, usng: usng_string };
        // UPS: { grid_zone: grid_zone, x: ups_x, y: ups_y, precision: precision, usng: usng_string };
        var p;
        if (sw_utm.precision === 0) {
            p = "100 km";
        } else if (sw_utm.precision === 1) {
            p = "10 km";
        } else if (sw_utm.precison === 2) {
            p = "1 km";
        } else {
            p = scale_factor.toFixed(0) + ' m';
        }

        return {
            precision: p,
            sw: utm_proj.invProj(sw_utm.zone, sw_utm.easting,                sw_utm.northing),
            nw: utm_proj.invProj(sw_utm.zone, sw_utm.easting,                sw_utm.northing + scale_factor),
            ne: utm_proj.invProj(sw_utm.zone, sw_utm.easting + scale_factor, sw_utm.northing + scale_factor),
            se: utm_proj.invProj(sw_utm.zone, sw_utm.easting + scale_factor, sw_utm.northing),
            c: utm_proj.invProj(sw_utm.zone, sw_utm.easting + (scale_factor / 2.0), sw_utm.northing + (scale_factor / 2.0))
        };
    };
}
