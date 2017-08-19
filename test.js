var usng = require("./usng3.js");
var u = new usng();

var passed = 0;
var failed = 0;

function test_coordinate(lat, lon, digits, expect) {
    var res = u.fromLonLat({lat: lat, lon: lon}, digits);

    if ( res === expect ) {
	console.log("test_coordinate: " + lat + " " + lon + " " + res + " PASSED");
	passed++;
    } else {
	console.log("test_coordinate: " + lat + " " + lon + " " + res + " != " + expect + " FAILED");
	failed++;
    }
}

function test_usng_parse(usng, lat, lon) {
    var res;

    console.log(usng, lat, lon);
    try {
	if (lat === undefined) {
	    res = u.toLonLat(usng)
	} else {
	    res = u.toLonLat(usng, {lat: lat, lon: lon});
	}
    } catch(e) {
	return {error: e};
    }
    return res;
}

function expect(res, lat, lon, precision) {
    if (res.error) {
	if(lat == null) {
	    console.log(res.error + " PASSED");
	    passed++;
	} else {
	    console.log(res.error + " FAILED");
	    failed++;
	}
    } else {
	if ( (Math.abs(res.lat - lat) < 0.00001) &&
	     (Math.abs(res.lon - lon) < 0.00001) &&
	     res.precision === precision ) {
	    console.log(res.lat + " " + res.lon + " " + res.precision + " PASSED");
	    passed++;
	} else {
	    console.log(res.lat + " " + res.lon + " " + res.precision + " FAILED");
	    failed++;
	}
    }
    console.log("");
}

test_coordinate(44.999995, -93.0, 4, "15T WK 0000 8294");
test_coordinate(45, 267.11, 4, "15T WK 0866 8295");
test_coordinate(70, 40, 4, "37W ET 3816 6618");
test_coordinate(-70, 40, 4, "37D EC 3816 3381");
test_coordinate(70, -40, 4, "24W VC 6183 6618");
test_coordinate(-70, -40, 4, "24D VH 6183 3381");
test_coordinate(84.1, 40, 4, "Z GB 2140 9778");
test_coordinate(-80.1, 40, 4, "B KW 0820 4400");
test_coordinate(84.1, -40, 4, "Y TB 7859 9778");
test_coordinate(-80.1, -40, 4, "A QW 9179 4400");
test_coordinate(88, 40, 4, "Z BF 4274 2988");
test_coordinate(-88, 40, 4, "B BP 4274 7011");
test_coordinate(88, -40, 4, "Y YF 5725 2988");
test_coordinate(-88, -40, 4, "A YP 5725 7011");
test_coordinate(0, 0, 4, "31N AA 6602 0000");
test_coordinate(44.876, -93.12456789, 4, "15T VK 9016 6918");
test_coordinate(38.894, -77.043, 5, "18S UJ 22821 06997");

expect(test_usng_parse("15t vk 1234 5678"), 44.75904, -94.10759, 4);
expect(test_usng_parse("vk 1234 5678", 44, -93), 44.75904, -94.10759, 4);
expect(test_usng_parse("1234 5678", 44, -93), 43.86401, -92.84644, 4);
expect(test_usng_parse("vk", 44, -93), 44.24637, -94.25248, 0);
expect(test_usng_parse("15t vk"), 44.24637, -94.25248, 0);
expect(test_usng_parse("A VK 0 0"), null, null, null); // invalid
expect(test_usng_parse("18S UJ 228 070"), 38.8940174428622, -77.04324684425941, 3);
expect(test_usng_parse("UJ 228 070", 38.894, -77.043), 38.8940174428622, -77.04324684425941, 3);
expect(test_usng_parse("228 070", 38.894, -77.043), 38.8940174428622, -77.04324684425941, 3);
expect(test_usng_parse("B AN"), -90, 0, 0);
expect(test_usng_parse("Y ZP 12345 12345"), 84.43254784831868, -171.85365493260602, 5);

console.log("PASSED: " + passed + " FAILED: " + failed);

process.exit( (failed === 0) ? 0 : 1 );
