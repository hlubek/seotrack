
/**
 * Module dependencies.
 */

var express = require('express'),
    connect = require('connect'),
    auth = require('../connect-auth/lib/auth'),
    Do = require('./lib/do'),
    utils = require('./lib/utils'),
    seotrack = require('./lib/seotrack'),
    couchdb = require('./lib/node-couchdb/couchdb'),
	client = couchdb.createClient(5984, 'localhost'),
	db = client.db('seotrack');


/*

CouchDB Design Document:

"views": {
       "sitesByUrl": {
           "map": "function(doc) {\u000a  if (doc.type == 'site') {\u000a    emit(doc.url, doc);\u000a  }\u000a}\u000a"
       },
       "results": {
           "map": "function(doc) {\u000a  if (doc.type == 'result') {\u000a    emit([doc.site, doc.keyword, doc.date.substr(0, 4), doc.date.substr(5, 2), doc.date.substr(8, 2)], doc.position);\u000a  }\u000a}\u000a",
           "reduce": "function(keys, values, rereduce) {\u000a  if (!rereduce) {\u000a    return [sum(values), values.length];\u000a  } else {\u000a    var s = 0, items = 0;\u000a    values.forEach(function(value) {\u000a      s += value[0];\u000a      items += value[1];\u000a    });\u000a    return [s, items];\u000a  }\u000a}"
       }
   }

*/

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


// Authentication

var getPasswordForUserFunction = function(username, cb) {
	db.view('app', 'usersByUsername', {key: username}, function(er, result) {
		if (er) {
			return cb(er);
		}
		if (result.rows.length > 0) {
			return cb(null, result.rows[0].value.password, result.rows[0].value);
		} else {
			console.log('No such user: ' + username);
			// Returning undefined should reauthenticate properly
			return cb(null, undefined);
		}
	});
};

var errorHandler = function(error) {
	throw new Error(JSON.stringify(error));
};

var app = module.exports = express.createServer();

// Configuration

app.configure(function() {
    app.set('views', __dirname + '/views');
    app.use(connect.bodyDecoder());
    
    app.use(auth([
    	auth.Digest({getPasswordForUser: getPasswordForUserFunction})
    ]));
    
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

app.getAuthenticated = function(route, callback) {
	app.get(route, function(req, res) {
		req.authenticate(['digest'], function(er, authenticated) {
			if (er) {
				return errorHandler(er, req, res);
			}
			if (authenticated) {
				callback(req, res);
			} else {
				// FIXME Can it happen?
				errorHandler('Not authenticated', req, res);
			}
		});
	});
};

/*

TODO Implement basic authorization framework

authorization.rolesForUser = function(user) {
	return user.roles;
};

authorization.role('admin', function(role) {
	role.hasPermissionOn('site', ['view']);
});

authorization.role('user', function(role) {
	role.hasPermissionOn('site', ['view'], function(user, site) {
		return user.sites.indexOf(site.url) !== -1;
	});
});

*/

var authorized = function(req) {
	return {
		to: function(action, scope) {
			var user = req.getAuthDetails().user;
			if (action === 'view' && scope === 'site') {
				// Either admin or in sites properties of user
				return function(context) {
					return user.details.roles.indexOf('admin') !== -1 ||
						user.details.sites.indexOf(context.url) !== -1;
				};
			}
			return function(context) {
				return false;
			};
		}
	};
};

var layoutLocals = function(req) {
	return {
		user: req.getAuthDetails().user.details
	};
};

app.get('/', function(req, res) {
    res.render('index.jade', {
        locals: {
            title: 'Seotrack'
        }
    });
});

app.getAuthenticated('/sites', function(req, res) {
	Do.parallel(
		view('app', 'sitesByUrl', {})		
	)(function(sitesData) {
		var sites = sitesData.rows.map(function(entry) { return entry.value; });
		// Filter sites by authorizations
		sites = sites.filter(authorized(req).to('view', 'site'));
		res.render('sites.jade', {
			locals: utils.merge(layoutLocals(req), {
				title: 'Configured sites',
				sites: sites
			})
		});		
	}, errorHandler);
});

app.getAuthenticated('/sites/*', function(req, res) {
	var url = req.params[0];
	if (!authorized(req).to('view', 'site')({url: url})) {
		res.writeHead(403, { 'Content-Type': 'text/plain' });
	    res.end('Not authorized');
	    return;
	}
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
	        locals: utils.merge(layoutLocals(req), {
	        	title: 'Site details',
        	    site: site,
        	    positionsByKeyword: positionsByKeyword
    	    })
	    });
	}, errorHandler);
});

// Only listen on $ node app.js

if (!module.parent) app.listen(3000);
