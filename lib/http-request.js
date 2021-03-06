'use strict';

const qs = JSON; // require('querystring');
const fs = require('fs');
const q = Promise || require('q').Promise;
const os = require('os');
const http = require('http');
const https = require('https');
const url = require('url');

exports = module.exports;

function parseUrl(requrl) {
	var parsedUrl = url.parse(requrl, true);
	if(parsedUrl.protocol === "https:") {
		parsedUrl.https = true;
	} else {
		parsedUrl.https = false;
	}
	return parsedUrl;
}

function getOptions(_url, params, method, headers) {
	var options = {
		host: null,
		port: -1,
		path: null
	};
	options.host = _url.hostname;
	options.port = _url.port;
	options.path = _url.pathname;
	options.method = method;
	options.timeout = 20000;

	if(params) {
		options.headers = {
			'Content-Type': 'application/x-www-form-urlencoded',
			'Content-Length': Buffer.byteLength(params)
		}
	}

	if(headers) {
		options.headers = options.headers || {};
		for(var key in headers) {
			options.headers[key] = headers[key];
		}
	}

	_url.search && (options.path += _url.search)
	_url.https && (options.checkServerIdentity = function(host, cert) { return undefined; })

	return options;
}

function _send(requrl, data, method, headers, is_res, retry) {
	return new q(function(resolve, reject) {
		var params = '';
		if(data) {
			if(data.constructor.name == "String") {
				params = data;
			}
			if(data.constructor.name == "Object") {
				params = qs.stringify(data);
			}
		}

		var _url = parseUrl(requrl);
		var options = getOptions(_url, params, method, headers);
		var _http = null;
		if(_url.https) {
			_http = https;
		} else {
			_http = http;
		}
		var timeoutEventId;

		var req = _http.request(options, function(res) {
			if(is_res == true) {
				resolve(res);
			} else {
				res.setEncoding('utf8');
				var result = '';
				res.on('data', function(chunk) {
					result += chunk;
				});
				res.on('end', function() {
					if(timeoutEventId) clearTimeout(timeoutEventId);
					try {
						result = JSON.parse(result);
					} catch(e) {}
					resolve(result);
				});
				res.on('error', function(err) {
					reject(err);
				});
			}
		});

		if(options.timeout) {
			timeoutEventId = setTimeout(function() {
				req.emit('error', 10001);
			}, options.timeout)
		}

		if(params) {
			req.write(params);
		}

		req.on('error', function(err) {
			if(timeoutEventId) clearTimeout(timeoutEventId);
			if(err == 10001) {
				req.res && req.res.abort();
				req.abort();
				err = new Error('连接超时');
				err.code = 10001;
				reject(err);
			} else {
				reject(err);
			}
		});
		req.end();
	});
}

function _sendRetry(requrl, data, method, headers, is_res) {
	if(is_res == true) {
		return _send(requrl, data, method, headers, is_res);
	} else {
		var retry = 0;
		return new q(function(resolve, reject) {
			var sender = function() {
				_send(requrl, data, method, headers, is_res)
					.then(function(r) {
						resolve(r);
					}, function(e) {
						retry += 1;
						if(e.code == 10001) {
							if(retry == 3) {
								reject(e);
							} else {
								sender();
							}
						} else {
							retry = 3;
							sender();
						}
					});
			}
			sender();
		});
	}
}

/**
 * @param {String} requrl
 * @param {Object|String} data
 * 		如果data是json，例如{a:1,b:2}，则将其转换成a=1&b=2
 * 		如果data是string，则不转换，直接发送
 * @param {Object}	headers	自定义请求头
 * @param {Boolean} is_res	是否直接返回响应流
 * @return {Promise}	返回的内容
 */
exports.Post = function(requrl, data, headers, is_res) {
	return _send(requrl, data, 'post', headers, is_res)
}

/**
 * @param {String} requrl
 * @param {Object|String} data
 * 		如果data是json，例如{a:1,b:2}，则将其转换成a=1&b=2
 * 		如果data是string，则不转换，直接发送
 * @param {Object}	headers	自定义请求头
 * @param {Boolean} is_res	是否直接返回响应流
 * @return {Promise}	返回的内容
 */
exports.Put = function(requrl, data, headers, is_res) {
	return _send(requrl, data, 'put', headers, is_res)
}

/**
 * @param {String} requrl
 * @param {Object}	headers	自定义请求头
 * @param {Boolean} is_res	是否直接返回响应流
 * @return {Promise}	返回的内容
 */
exports.Get = function(requrl, headers, is_res) {
	return _send(requrl, null, 'get', headers, is_res)
}

/**
 * @param {String} requrl
 * @param {Object}	headers	自定义请求头
 * @param {Boolean} is_res	是否直接返回响应流
 * @return {Promise}	返回的内容
 */
exports.Delete = function(requrl, headers, is_res) {
	return _send(requrl, null, 'delete', headers, is_res)
}

/**
 * @param {String} requrl	网络文件路径
 * @param {String} saveurl	本地文件路径
 * @return {Promise}		true|false
 */
exports.Download = function(requrl, saveurl) {
	return new q(function(resolve, reject) {
		var _url = parseUrl(requrl);
		var options = getOptions(_url, null, 'get');
		var _http = null;
		if(_url.https) {
			_http = https;
		} else {
			_http = http;
		}
		var req = _http.request(options, function(res) {
			var writer = fs.createWriteStream(saveurl, { flags: 'wx+' });
			writer.on('error', function(err) {
				writer.end();
				reject(err);
			})
			var receive = 0;
			var max = +res.headers['content-length'];
			res.pipe(writer)
			res.on('error', function(err) {
				resolve(err);
			})
			res.on('data', function(chunk) {
				receive += chunk.length;
				var percent = (receive / max) * 100
				notify(percent.toFixed(2));
			})
			res.on('end', function() {
				resolve(true);
			});
		});
		req.on('error', function(err) {
			resolve(err);
		});
		req.end();
	});
}

exports.FileLength = function(requrl) {
	return new q(function(resolve, reject) {
		var _url = parseUrl(requrl);
		var options = getOptions(_url, null, 'get');
		var _http = null;
		if(_url.https) {
			_http = https;
		} else {
			_http = http;
		}
		var req = _http.request(options, function(res) {
			var max = +res.headers['content-length'];
			resolve(max);
			req.abort();
		});
		req.on('error', function(err) {
			resolve(err);
		});
		req.end();
	});
}

exports.DownloadParallel = function(requrl, saveurl, maxLength, cpus) {
	return new q(function(resolve, reject) {
		var startTime = Date.now();
		cpus = cpus > 0 ? cpus : os.cpus().length;
		var unit = Math.ceil(maxLength / cpus);
		var ranges = [];
		for(var i = 0; i < cpus; i++) {
			var min, max;
			if(i == 0) {
				min = i * unit;
				max = (i + 1) * unit;
			} else if(i > 0 && i < cpus - 1) {
				min = ranges[i - 1].max + 1;
				max = min + unit;
			} else {
				min = ranges[i - 1].max + 1;
				max = maxLength - 1;
			}
			ranges.push({
				min: min,
				max: max
			});
		}

		var result = new Array(4);
		var completeCount = 0;
		var receive = 0;
		var abort = false;
		for(let i = 0; i < ranges.length; i++) {
			let item = ranges[i];
			let h = {}
			h['Range'] = ' bytes=' + item.min + '-' + item.max;
			_send(requrl, null, 'get', h, true)
				.then(function(res) {
					let bufs = [];
					let total = 0;
					res.on('data', function(chunk) {
						receive += chunk.length;
						total += chunk.length;
						bufs.push(chunk);
						var percent = (receive / maxLength) * 100
						notify(percent.toFixed(2));
					});
					res.on('end', function() {
						let buffers = Buffer.concat(bufs, total);
						result[i] = buffers;
						completeCount += 1;
					});
					res.on('error', function(err) {
						abort = true;
						reject(err);
					});
				}, function(e) {
					abort = true;
					reject(e);
				})
		}

		var timer = setInterval(function() {
			if(abort == true) {
				clearInterval(timer);
			}
			if(completeCount == 4) {
				var img = Buffer.concat(result, maxLength);
				clearInterval(timer);
				fs.open(saveurl, "w+", function(err, fd) {
					fs.write(fd, img, 0, img.length, 0, function(err, written, buffer) {
						if(err) {
							reject(err);
						} else {
							var fileLength = (maxLength / 1024).toFixed(3);
							var time = ((Date.now() - startTime) / 1000).toFixed(3);
							var rate = (fileLength / time).toFixed(2) + 'kb/s';
							resolve({
								max: fileLength,
								time: time,
								saveAs: saveurl,
								rate: rate
							});
						}
					});
				})
			}
		}, 10)
	});
}