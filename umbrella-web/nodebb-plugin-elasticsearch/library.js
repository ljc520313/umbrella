"use strict";

var plugin = {},
string = require('string'),
elasticsearch = require('elasticsearch'),
fs = require('fs-extra'),
jquery = fs.readFileSync("./node_modules/nodebb-plugin-kernel/jquery-2.1.4.min.js", "utf-8"),
jsdom = require("jsdom"),
client = null,
async = module.parent.require('async'),
_ = module.parent.require('underscore'),
meta = module.parent.require('./meta'),
topics = module.parent.require('./topics'),
posts = module.parent.require('./posts'),
user = module.parent.require('./user'),
categories = module.parent.require('./categories'),
plugins = module.parent.require('./plugins'),
winston = module.parent.require('winston'),
nconf = module.parent.require('nconf');

var insert = (type, id, value, cid, uid, next) => {
	next = next || function() {};

	var query = {
		index: 'umbrella',
		type: type,
		id: id,
		body: {
			deleted: false,
			cid: parseInt(cid, 10),
			uid: parseInt(uid, 10)
		}
	}
	if(type == 'topic') {
		query.body.title = value;
	} else {
		query.body.content = value;
	}
	client.create(query, next);
};

var update = (type, id, value, next) => {
	next = next || function() {};

	var query = {
		index: 'umbrella',
		type: type,
		id: id,
		body: {
			doc: null
		}
	};
	if(type == 'topic') {
		query.body.doc = {title: value};
	} else {
		query.body.doc = {content: value};
	}
	client.update(query, next);
};

var purge = (type, id, next) => {
	next = next || function() {};

	client.delete(
	{
		index: 'umbrella',
		type: type,
		id: id
	}, next)
};

plugin.init = (data, next) => {
	next = next || function() {};

	client = new elasticsearch.Client({
		host: nconf.get('elasticsearch:host') + ':' + nconf.get('elasticsearch:port'),
		log: 'error'
	});
	next();
};

plugin.search = (data, next) => {
	next = next || function() {};

	if(!data || !data.index) {
		return next(null, [])
	}

	if(!data.content) {
		return next(null, []);
	}

	var uid = data.uid.filter(item => parseInt(item, 10))
	var cid = data.cid.filter(item => parseInt(item, 10))
	var query = {
		index: 'umbrella',
		type: data.index,
		body: {
			fields: [],	//use empty fields to minimize I/O
			query: {
				bool: {
					must: [
						{
							term: {
								deleted: false
							}
						}
					],
					should: {
						match: null
					},
					minimum_should_match: 1
				}
			},
			size: 1000
		}
	}
	if(uid.length > 0) {
		query.body.query.bool.must.push(
			{
				terms: {
					uid: uid
				}
			}
		);
	}
	if(cid.length > 0) {
		query.body.query.bool.must.push(
			{
				terms: {
					cid: cid
				}
			}
		);
	}
	if(data.index == 'topic') {
		query.body.query.bool.should.match = {
			title: data.content
		}
	} else if(data.index == 'post') {
		query.body.query.bool.should.match = {
			content: data.content
		}
	} else {
		return next('no this type of index ['+data.index+'] defined.')
	}
	async.waterfall([
		(next) => client.search(query, next),
		(res, httpCode, next) => next(null, res.hits.hits.map(item => parseInt(item._id, 10)))
	], next);
};

plugin.topic = {};

plugin.topic.post = (topic, next) => {
	next = next || function() {};

	return insert('topic', topic.tid, topic.title, topic.cid, topic.uid, next);
};

plugin.topic.delete = (topic, next) => {
	next = next || function() {};

	var query = {
		body: [
			{ update: { _index: 'umbrella', _type: 'topic', _id: topic.tid } },
			{ doc: { deleted: true } }
		]
	};

	async.waterfall([
		(next) => topics.getPids(topic.tid, next),
		(pids, next) => {
			pids.forEach((pid) => {
				query.body.push(
					{ update: { _index: 'umbrella', _type: 'post', _id: pid } },
					{ doc: { deleted: true } }
				)
			})
			client.bulk(query, next)
		}
	], next)
};

plugin.topic.edit = (topic, next) => {
	next = next || function() {};

	return update('topic', topic.tid, topic.title, next);
};

plugin.topic.restore = (topic, next) => {
	next = next || function() {};

	var query = {
		body: [
			{ update: { _index: 'umbrella', _type: 'topic', _id: topic.tid } },
			{ doc: { deleted: false } }
		]
	};
	async.waterfall([
		(next) => topics.getPids(topic.tid, next),
		(pids, next) => {
			pids.forEach(pid => {
				query.body.push(
					{ update: { _index: 'umbrella', _type: 'post', _id: pid } },
					{ doc: { deleted: false } }
				)
			})
			client.bulk(query, next)
		}
	], next)
};

plugin.topic.purge = (tid, next) => {
	next = next || function() {};

	return purge('topic', tid, next);
};

plugin.topic.move = (info, next) => {
	next = next || function() {};

	var query = {
		body: [
			{ update: { _index: 'umbrella', _type: 'topic', _id: info.tid } },
			{ doc: { cid: parseInt(info.toCid, 10) } }
		]
	};
	async.waterfall([
		(next) => topics.getPids(info.tid, next),
		(pids, next) => {
			pids.forEach(pid => {
				query.body.push(
					{ update: { _index: 'umbrella', _type: 'post', _id: pid } },
					{ doc: { cid: parseInt(info.toCid, 10) } }
				);
			})
			client.bulk(query, next)
		}
	], next)
};

plugin.post= {};

plugin.post.save = (post, next) => {
	next = next || function() {};

	async.waterfall([
		(next) => plugins.fireHook('filter:parse.raw', post.content, next),
		(html, next) => {
			jsdom.env({
				html: html,
				src: [jquery],
				done: (err, window) => {
					next(err, window, html)
				}
			})
		},
		(window, html, next) => {
			var text = window.$(html).text()
			window.close()
			insert('post', post.pid, text, post.cid, post.uid, next);
		}
	], next);
};

plugin.post.delete = (pid, next) => {
	next = next || function() {};

	return client.update(
		{
			index: 'umbrella',
			type: 'post',
			id: pid,
			body: {
				doc: {
					deleted: true
				}
			}
		}, next);
	};

plugin.post.edit = (post, next) => {
	next = next || function() {};

	async.waterfall([
		(next) => plugins.fireHook('filter:parse.raw', post.content, next),
		(html, next) => {
			jsdom.env({
				html: html,
				src: [jquery],
				done: (err, window) => {
					next(err, window, html);
				}
			})
		},
		(window, html, next) => {
			var text = window.$(html).text();
			window.close();
			update('post', post.pid, text, next);
		}
	], next);
};

plugin.post.restore = (post, next) => {
	next = next || function() {};

	return client.update(
		{
			index: 'umbrella',
			type: 'post',
			id: post.pid,
			body: {
				doc: {
					deleted: false
				}
			}
		}, next);
	};

plugin.post.purge = (pid, next) => {
	next = next || function() {};

	return purge('post', pid, next);
};

plugin.post.move = (info, next) => {
	next = next || function() {};

	async.waterfall([
		(next) => topics.getTopicField(info.tid, 'cid', next),
		(cid, next) => client.update(
			{
				index: 'umbrella',
				type: 'post',
				id: info.post.pid,
				body: {
					doc: {
						cid: parseInt(cid, 10)
					}
				}
			}, next)
	], next)
};

plugin.morelikethis = (data, next) => {
	next = next || function() {};

	var query =
	{
	  index: 'umbrella',
	  type: 'topic',
	  body: {
	    fields: [], //use empty fields to minimize I/O
	    query: {
	      bool: {
	        must: [
	          {
	            term: {
	              deleted: false
	            }
	          }
	        ],
	        should: {
	          more_like_this: {
	            fields: [
	              "title"
	            ],
	            docs: [
	              {
	                _index: "umbrella",
	                _type: "topic",
	                _id: parseInt(data.topicData.tid, 10)
	              }
	            ],
	            min_term_freq: 1,
	            max_query_terms: 10,
	            min_doc_freq: 1
	          }
	        },
	        minimum_should_match: 1
	      }
	    },
	    size: 10
	  }
	}

	async.waterfall([
	  (next) => client.search(query, next),
	  (res, httpCode, next) => {
	    if(res.hits.hits.length == 0) {
	      return next('NO_SIMILAR_TOPIC')
	    }

	    topics.getTopicsData(res.hits.hits.map(item => parseInt(item._id, 10)), next)
	  },
		(similar, next) => {
	    var mapFilter = (array, field) => {
	      return array.map(topic => topic && topic[field] && topic[field].toString())
	           .filter((value, index, array) => string(value).isNumeric() && array.indexOf(value) === index)
	    }
	    next(null, similar, mapFilter(similar, 'cid'), mapFilter(similar, 'uid'))
	  },
		(similar, cids, uids, next) => {
	    async.parallel({
	      users : (next) => user.getUsersFields(uids, ['uid', 'username', 'userslug', 'picture'], next),
	      categories : (next) => categories.getCategoriesFields(cids, ['cid', 'name', 'slug', 'icon', 'bgColor', 'color', 'disabled'], next)
	    }, (err, results) => {
	      if(err) {
	        return next(err)
	      }

	      var categories = _.object(cids, results.categories);
	      var users = _.object(uids, results.users);
	      similar.forEach(item => {
	        item.category = categories[item.cid];
	        item.user = users[item.uid];
	      })
	      data.topicData.similar = similar;
	      next()
	    })
	  }
	], (err) => {
	  if(err && err != 'NO_SIMILAR_TOPIC') {
	    return next(err)
	  }

	  next(null, data)
	})
};

module.exports = plugin;
