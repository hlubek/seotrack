var	sys = require('sys'),
	http = require('http'),
	querystring = require('querystring');

var googleClient;

var SeotrackService = exports.SeotrackService = function(db, config) {
	this.db = db;
	this.config = config;
};

exports.createService = function(db, config) {
	googleClient = http.createClient(80, 'ajax.googleapis.com');
	var service = new SeotrackService(db, config);
	return service;
};

var apiRequest = function(keyword, start, callback) {
	var request = googleClient.request(
		'GET',
		'/ajax/services/search/web?v=1.0&q=' + querystring.escape(keyword) + '&rsz=8&start=' + start + '&key=ABQIAAAAf2VmCCi_KCBMr5K612OtThSpYmHx8xTHAbb0tD9kbwFH1LyhnBRGRTh_YsuYifY0uqFe0IGrM_pIBw',
		{'Host': 'ajax.googleapis.com', 'Referer': 'http://www.networkteam.com'});
	request.end();
	request.on('response', function (response) {
	  var body = '';
	  response.on('data', function (chunk) {
	    body += (chunk || '');
	  });
	  response.on('end', function () {
	    var json = JSON.parse(body);
	    if (json.responseStatus && json.responseStatus == 200) {
		    callback && callback(null, json);
		} else {
			callback && callback(json.responseDetails);
		}	
	  });
	});
};

SeotrackService.prototype.findPosition = function(url, keyword, callback, start) {
	var that = this;
	// TODO append missing slash to url

	if (start === undefined) {
		start = 0;
	}
	if (start >= 64) {
		return callback(null, undefined);
	}

	apiRequest(keyword, start, function(err, data) {
		if (err) {
			return callback(err);
		}
		if (data.responseData) {
			var foundPosition = false;
			data.responseData.results.forEach(function(result, i) {
				if (foundPosition) return;
				if (result.url.substr(0, url.length) == url) {
					foundPosition = true;
					callback(null, start + i + 1);
				}
			});
			if (!foundPosition) {
				that.findPosition(url, keyword, callback, start + 8);
			}
		}
	});
};

SeotrackService.prototype.updatePositions = function(config, cb) {
	var that = this,
		site;
	for (site in config) {
		(function(site) {
			var keywords = config[site];
			keywords.forEach(function(keyword) {
				that.findPosition(site, keyword, function(er, position) {
					if (er) {
						// FIXME jump out of function on error?
						return cb && cb(er);
					}
					var date = new Date(),
						id = site + '-' + keyword + '-' + date.getTime();
					that.db.saveDoc(querystring.escape(id), {
						type: 'result',
						site: site,
						keyword: keyword,
						position: position,
						date: date
					}, function(er, ok) {
						if (er) {
							return cb && cb(er);
						}
						cb && cb(null, ok);
					});
				});
			});
		})(site);
	}
};
