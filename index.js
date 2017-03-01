'use strict';
var gutil = require('gulp-util');
var through = require('through2');
var transform = require('./lib/transform');

module.exports = function (opts) {
	opts = opts || {};

	return through.obj(function (file, enc, cb) {
		if (file.isNull()) {
			cb(null, file);
			return;
		}

		if (file.isStream()) {
			cb(new gutil.PluginError('gulp-polymer-expr', 'Streaming not supported'));
			return;
		}

		try {
			file.contents = new Buffer(transform(file.contents.toString(), opts));
			this.push(file);
		} catch (err) {
			this.emit('error', new gutil.PluginError('gulp-polymer-expr', err));
		}

		cb();
	});
};
