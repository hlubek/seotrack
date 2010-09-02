
/**
 * Module dependencies.
 */

var express = require('express'),
    connect = require('connect'),
    querystring = require('querystring'),
    Do = require('./lib/do'),
    seotrack = require('./lib/seotrack'),
    couchdb = require('./lib/node-couchdb/couchdb'),
	client = couchdb.createClient(5984, 'localhost'),
	db = client.db('seotrack');

var view = function(design, view, query) {
	return function(callback, errback) {	
		db.view(design, view, query, function(er, result) {
			if (er) {
				errback(er);
			} else {
				callback(result);
			}
		});
	};
};

var errorHandler = function(error) {
	throw new Error(JSON.stringify(error));
};

var app = module.exports = express.createServer();

// Configuration

app.configure(function(){
    app.set('views', __dirname + '/views');
    app.use(connect.bodyDecoder());
    app.use(connect.methodOverride());
    app.use(connect.compiler({ src: __dirname + '/public', enable: ['less'] }));
    app.use(app.router);
    app.use(connect.staticProvider(__dirname + '/public'));
});

app.configure('development', function() {
    app.use(connect.errorHandler({ dumpExceptions: true, showStack: true })); 
});

app.configure('production', function() {
	app.use(connect.errorHandler()); 
});

// Routes

app.get('/', function(req, res) {
    res.render('index.jade', {
        locals: {
            title: 'Express'
        }
    });
});

app.get('/sites', function(req, res) {
	Do.parallel(
		view('app', 'sitesByUrl', {})		
	)(function(sitesData) {
		var sites = sitesData.rows.map(function(entry) { return entry.value; });
		res.render('sites.jade', {
	        locals: {
	        	title: 'Configured sites',
        	    sites: sites
    	    }
	    });		
	}, errorHandler);
});
app.get('/sites/*', function(req, res) {
	var url = req.params[0];
	Do.parallel(
		view('app', 'sitesByUrl', {key: url}),
		view('app', 'results', {group: true, group_level: 5, startkey: [url], endkey: [url, {}]})
	)(function(sitesData, resultsData) {
		var site = sitesData.rows[0].value,
			results = resultsData.rows,
			positionsByKeyword = {};
		results.forEach(function(result) {
			var keyword = result.key[1],
				dateString = result.key[2] + '-' + result.key[3] + '-' + result.key[4];
			positionsByKeyword[keyword] = positionsByKeyword[keyword] || [];
			if (result.value[0] !== 0) {
				positionsByKeyword[keyword].push([new Date(dateString).getTime(), Math.ceil(result.value[0] / result.value[1])]);
			}
		});
		res.render('site.jade', {
	        locals: {
	        	title: 'Site details',
        	    site: site,
        	    positionsByKeyword: positionsByKeyword
    	    }
	    });
	}, errorHandler);
});

// Only listen on $ node app.js

if (!module.parent) app.listen(3000);
