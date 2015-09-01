"use strict";

var plugin = {},
	net = require('net'),
	jsdom = require("jsdom"),
	fivebeans = require('fivebeans'),
	string = require('string'),
	winston = module.parent.require('winston'),
	async = module.parent.require('async'),
	topics = module.parent.require('./topics'),
	plugins = module.parent.require('./plugins'),
	posts = module.parent.require('./posts');

plugin.http = {};

plugin.http.get = function(req, res, next) {
	return res.render('kernel', {});
};

plugin.http.post = function(req, res, next) {
	var content = req.body.content;
	if(!content) {
		return res.json({success: false, msg: '没有脚本可以运行'})
	}
	content = JSON.parse(content);
	var kernel = {id:'kernel', dir:'/home/ubuntu/git/umbrella-web/public/kernel/temp/', scripts:content};
	var conn = new net.Socket();
		conn.connect(8001, 'localhost', function() {
		conn.write(JSON.stringify(kernel));
	});
	conn.on('data', function(data) {
		conn.destroy();
		return res.json({success: true, data: new Buffer(data).toString()});
	});
	conn.on('error', function(err) {
		winston.error(err);
		return res.sendStatus(500);
	});
};

plugin.init = function(data, callback) {

	data.router.get('/api/kernel', plugin.http.get);

	data.router.post('/kernel', data.middleware.applyCSRF, plugin.http.post);

	callback();
};

plugin.topic = {};

plugin.topic.list = function(data, callback) {
	var topic_list = data.topics;
	async.map(topic_list, function(topic, next) {
		topics.getMainPost(topic.tid, topic.uid, function (err, post){
			if(err) {
				return next(err);
			}
			if(post.status == 1) {
				topic.title = '<span class="waiting"><i class="fa fa-clock-o"></i> 等待运算</span> ' + topic.title;
			} else if(post.status == 2) {
				topic.title = '<span class="evaluate"><i class="fa fa-play"></i> 正在计算</span> ' + topic.title;
			} else if(post.status == 3) {
				topic.title = '<span class="finished"><i class="fa fa-check"></i> 计算完成</span> ' + topic.title;
			} else if(post.status == -1) {
				topic.title = '<span class="error"><i class="fa fa-remove"></i> 语法错误</span> ' + topic.title;
			} else if(post.status == -2) {
				topic.title = '<span class="aborted"><i class="fa fa-exclamation"></i> 计算超时</span> ' + topic.title;
			}
			return next(null, topic);
		});
	}, function(err) {
		return callback(err, data);
	});
};

plugin.topic.get= function(data, callback) {
	var topic = data.topic;
	async.map(topic.posts, function (post, next) {
		if(post.pid == topic.mainPid) {
			if(post.status == 1) {
				topic.waiting = true;
			} else if(post.status == 2) {
				topic.evaluate = true;
			} else if(post.status == 3) {
				topic.finished = true;
			} else if(post.status == -1) {
				topic.error = true;
			} else if(post.status == -2) {
				topic.aborted = true
			}
		}
		if(post.result && post.result.length > 0 && post.code && post.code.length > 0) {
			jsdom.env(
			post.content,
			['http://www.wiseker.com/vendor/jquery/js/jquery.js'],
			function (err, window) {
				if (err) {
					window.close();
					winston.error(err);
					return next(err);
				}
				var codes = window.$("code[class='language-mma']");
				for(var i = 0; i < post.result.length; i++) {
					if(post.result[i].type == 'return' || post.result[i].type == 'text') {
						window.$(codes[post.result[i].index]).after('<div class="kernel result alert alert-success" role="alert">'+post.result[i].data+'</div>');		
					} else if(post.result[i].type == 'error') {
						window.$(codes[post.result[i].index]).after('<div class="kernel result alert alert-danger" role="alert">'+post.result[i].data+'</div>');		
					} else if(post.result[i].type == 'abort') {
						window.$(codes[post.result[i].index]).after('<div class="kernel result alert alert-warning" role="alert">运行超时</div>');		
					} else if(post.result[i].type == 'image') {
						window.$(codes[post.result[i].index]).after("<img class='kernel result' src='/kernel/"+post.pid+"/"+post.result[i].data+"'></img>");		
					}
				}
				var html = window.document.documentElement.outerHTML;
				window.close();
				html = string(html).replaceAll('<html><head></head><body>', '').s;
				html = string(html).replaceAll('<script class="jsdom" src="http://www.wiseker.com/vendor/jquery/js/jquery.js"></script></body></html>', '').s;
				post.content = html;
				return next(null);
			});
		} else {
			return next(null);
		}
	}, function (err){
		return callback(err, data);
	});
};

plugin.post = {};

plugin.post.edit = function(post, callback) {
	callback = callback || function() {};
    jsdom.env(post.content, ['http://www.wiseker.com/vendor/jquery/js/jquery.js'],
    function (err, window) {
        if (err) {
            window.close();
            winston.error(err);
            return callback(err);
        }
        var codes = window.$("code[class='language-mma']");
        if (codes && codes.length > 0) {
            var scripts = [];
            for (var i = 0; i < codes.length; i++) {
                scripts.push(window.$(codes[i]).text());
            };
            window.close();
            var updateData = {
                code: scripts,
                status: 1
            }
            posts.setPostFields(post.pid, updateData, function (err) {
                if (err) {
                    return callback(err);
                }
                var beans = new fivebeans.client('localhost', 11300);
                beans.on('connect', function() {
                    beans.use('kernel', function (err) {
                        if (err) {
                            winston.error(err);
                            return callback(err)
                        }
                        beans.put(Math.pow(2, 32), 0, 120, JSON.stringify({
                            pid: post.pid,
                            action: 'update'
                        }), function (err, jobid) {
                            beans.end();
                            return callback(err, jobid);
                        });
                    });
                }).on('error', callback).connect();
            });

        } else {
            posts.setPostField(post.pid, 'status', 0, callback);
        }
    });
};

plugin.post.save = function(post, callback) {
    callback = callback || function() {};
    plugins.fireHook('filter:parse.raw', post.content,
    function(err, html) {
        if (err) {
            winston.error(err);
            return callback(err);
        }
        jsdom.env(html, ['http://www.wiseker.com/vendor/jquery/js/jquery.js'],
        function (err, window) {
            if (err) {
                window.close();
                winston.error(err);
                return callback(err);
            }
            var codes = window.$("code[class='language-mma']");
            if (codes && codes.length > 0) {
                var scripts = [];
                for (var i = 0; i < codes.length; i++) {
                    scripts.push(window.$(codes[i]).text());
                };
                window.close();
                var updateData = {
                    code: scripts,
                    status: 1
                }
                posts.setPostFields(post.pid, updateData, function (err) {
                    if (err) {
                        return callback(err);
                    }
                    var beans = new fivebeans.client('localhost', 11300);
                    beans.on('connect', function() {
                        beans.use('kernel', function (err) {
                            if (err) {
                                winston.error(err);
                                return callback(err)
                            }
                            beans.put(Math.pow(2, 32), 0, 120, JSON.stringify({
                                pid: post.pid,
                                action: 'create'
                            }), function (err, jobid) {
                                beans.end();
                                return callback(err, jobid);
                            });
                        });
                    }).on('error', callback).connect();
                });

            } else {
                posts.setPostField(post.pid, 'status', 0, callback);
            }
        });
    });
};

plugin.post.purge = function(pid, callback) {
	callback = callback || function() {};
	var beans = new fivebeans.client('localhost', 11300);
    beans.on('connect', function() {
        beans.use('kernel', function (err) {
            if (err) {
                winston.error(err);
                return callback(err)
            }
            beans.put(Math.pow(2, 32), 0, 120, JSON.stringify({
                pid: pid,
                action: 'delete'
            }), function (err, jobid) {
                beans.end();
                return callback(err, jobid);
            });
        });
    }).on('error', callback).connect();
};

module.exports = plugin;