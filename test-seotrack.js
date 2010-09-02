var seotrack = require('./lib/seotrack'),
    couchdb = require('./lib/node-couchdb/couchdb'),
	client = couchdb.createClient(5984, 'localhost'),
	db = client.db('seotrack');

var config = {
	'http://www.networkteam.com': [
		"Webdesign Kiel",
		"TYPO3 Kiel",
		"TYPO3 Hamburg",
		"Webdesign Hamburg"
	],
	'http://www.partnerboersen.net': [
		"Partnerboersen",
		"Partnerbörse",
		"Partnerbörsen",
		"Partnerbörsen Vergleich",
		"Partnersuche",
		"Singlebörsen",
		"Singlebörsen Vergleich",
		"flirten",
		"kontaktanzeigen",
		"kostenlose partnerbörsen",
		"online partnerbörsen",
		"partnerbörsen-vergleich",
		"partnerbörsenvergleich",
		"partnervermittlung",
		"sie sucht ihn",
		"singleboerse",
		"singlebörse"
	]
};

var seotrackService = seotrack.createService(db, {});
seotrackService.updatePositions(config, function(er, success) {
	if (er) {
		throw new Error(JSON.stringify(er));
	}
	console.log(success);
});
