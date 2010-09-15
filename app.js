
/**
 * Module dependencies.
 */

var express = require('express'),
    connect = require('connect'),
    auth = require('./lib/connect-auth/auth'),
    Do = require('./lib/do'),
    utils = require('./lib/utils'),
	querystring = require('querystring'),
    seotrack = require('./lib/seotrack'),
    couchdb = require('./lib/node-couchdb/couchdb'),
	client = couchdb.createClient(5984, 'localhost'),
	db = client.db('seotrack'),
    seotrackService = seotrack.createService(db, {});

/*

CouchDB Design Document:

"validate_doc_update": "function(newDoc, oldDoc, userCtx) {
	if (newDoc._deleted) return;
	function require(field, message) {
    	message = message || \"Document must have a \" + field;
		if (!newDoc[field]) throw({forbidden : message});
	};

	function unchanged(field) {
		if (oldDoc && toJSON(oldDoc[field]) != toJSON(newDoc[field])) {
			throw({forbidden : \"Field can't be changed: \" + field});
		}
	}
 
	var type = (oldDoc || newDoc).type;
	unchanged('type');
	if (type == 'site') {
		require('url');
		unchanged('url');
     }
}",
"views": {
	"sitesByUrl": {
		"map": "function(doc) {
			if (doc.type == 'site') {
				emit(doc.url, doc);
			}
		}"
   },
   "results": {
	   "map": "function(doc) {
			if (doc.type == 'result') {
				emit([doc.site, doc.keyword, doc.date.substr(0, 4), doc.date.substr(5, 2), doc.date.substr(8, 2)], doc.position);
			}
		}",
	   "reduce": "function(keys, values, rereduce) {
			if (!rereduce) {
				return [sum(values), values.length];
			} else {
				var s = 0, items = 0;
				values.forEach(function(value) {
					s += value[0];
					items += value[1];
				});
				return [s, items];
			}
		}"
	},
	"usersByUsername": {
		"map": "function(doc) {
			if (doc.type == \"user\") {
				emit(doc.username, doc);
			}
		}"
	}
}

*/


// Register daily update:

setInterval(function() {
	console.log('Updating results');
	db.view('app', 'sitesByUrl', {}, function(er, result) {
		var sites = result.rows.map(function(entry) { return entry.value; }),
			config = {};
		sites.forEach(function(site) {
			config[site.url] = site.keywords;
		});
		seotrackService.updatePositions(config, function(er, success) {
			if (er) {
				throw new Error(JSON.stringify(er));
			}
		});
	});
}, 24 * 60 * 60 * 1000);

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
	if (username === '_logout') {
		return cb(null, '_logout', {roles: []});
	}
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

var getPasswordForLogoutFunction = function(username, cb) {
	return cb(null, '_logout');
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
    	auth.Digest({getPasswordForUser: getPasswordForUserFunction}),
    	auth.Basic({getPasswordForUser: getPasswordForLogoutFunction})
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
				// errorHandler('Not authenticated', req, res);
				res.send('Not authenticated', 500);
			}
		});
	});
};

app.postAuthenticated = function(route, callback) {
	app.post(route, function(req, res) {
		req.authenticate(['digest'], function(er, authenticated) {
			if (er) {
				return errorHandler(er, req, res);
			}
			if (authenticated) {
				callback(req, res);
			} else {
				// FIXME Can it happen?
				// errorHandler('Not authenticated', req, res);
				res.send('Not authenticated', 500);
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
			} else if (action === 'view' && scope === 'users') {
				return function(context) {
					return user.details.roles.indexOf('admin') !== -1;
				};
			} else if (action === 'view' && scope === 'info') {
				return function(context) {
					return user.details.roles.indexOf('admin') !== -1;
				};
			} else if (action === 'create' && scope === 'site') {
				return function(context) {
					return user.details.roles.indexOf('admin') !== -1;
				};
			} else if (action === 'update' && scope === 'site') {
				return function(context) {
					return user.details.roles.indexOf('admin') !== -1 ||
						(user.details.roles.indexOf('siteadmin') !== -1 &&
						user.details.sites.indexOf(context.url) !== -1);
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
		user: req.getAuthDetails().user.details,
		authorized: authorized(req),
		navLink: function(path, label) {
			var styleClass = (req.url.indexOf(path) === 0) ? 'class="active"' : '';
			return '<a href="' + path + '" ' + styleClass + '>' + label + '</a>';
		}
	};
};

// GET /
app.get('/', function(req, res) {
    res.redirect('/sites');
});

// GET /sites
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

// POST /sites
app.postAuthenticated('/sites', function(req, res) {
	if (!authorized(req).to('create', 'site')()) {
		res.writeHead(403, { 'Content-Type': 'text/plain' });
	    res.end('Not authorized');
	    return;
	}
	var site = { type: 'site' };
	// TODO Validate URL
	site.url = req.body.url;
	// TODO Validate keywords, trim
	site.keywords = req.body.keywords.split(/\s*\r?\n\s*/);
	db.saveDoc(querystring.escape('site-' + site.url), site, function(er, ok) {
		if (er) {
			return res.send(utils.merge({success: false}, er));
		}
		res.send({success: true});
	});
});

// GET /sites/http://www.example.com
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
		if (sitesData.rows.length == 0) {
			return res.send(404);
		}
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

// POST /sites/http://www.example.com
app.postAuthenticated('/sites/*', function(req, res) {
	var url = req.params[0],
		id = req.body.id,
		rev = req.body.rev,
		site = {type: 'site', url: url, _id: id, _rev: rev};

	if (!authorized(req).to('update', 'site')(site)) {
		res.writeHead(403, { 'Content-Type': 'text/plain' });
	    res.end('Not authorized');
	    return;
	}

	// TODO Validate unchanged URL (in CouchDB?)

	// TODO Validate keywords, trim
	site.keywords = req.body.keywords.split(/\s*\r?\n\s*/);

	db.saveDoc(querystring.escape(site._id), site, function(er, ok) {
		if (er) {
			return res.send(utils.merge({success: false}, er));
		}
		res.send({success: true});
	});
});

// GET /users
app.getAuthenticated('/users', function(req, res) {
	if (!authorized(req).to('view', 'users')()) {
		res.writeHead(403, { 'Content-Type': 'text/plain' });
	    res.end('Not authorized');
	    return;
	}
	Do.parallel(
		view('app', 'usersByUsername', {})
	)(function(usersData) {
		var users = usersData.rows.map(function(entry) { return entry.value; });
		res.render('users.jade', {
	        locals: utils.merge(layoutLocals(req), {
	        	title: 'Users',
        	    users: users
    	    })
	    });
	}, errorHandler);
});

// GET /users
app.getAuthenticated('/info', function(req, res) {
	if (!authorized(req).to('view', 'info')()) {
		res.writeHead(403, { 'Content-Type': 'text/plain' });
	    res.end('Not authorized');
	    return;
	}
	res.render('info.jade', {
        locals: utils.merge(layoutLocals(req), {
        	title: 'Info',
       	    info: {
       	    	memory: process.memoryUsage()
       	    }
   	    })
    });
});


// Only listen on $ node app.js

if (!module.parent) app.listen(3000);
