## gulp-polymer-expr [![Build Status](https://travis-ci.org/garryyao/gulp-polymer-expr.svg?branch=master)](https://travis-ci.org/garryyao/gulp-polymer-expr)

> Syntactic SUGAR for JS expressions in Polymer [data binding annotation](https://www.polymer-project.org/1.0/docs/devguide/data-binding) , which is transpiled into [computed binding](https://www.polymer-project.org/1.0/docs/devguide/data-binding#annotated-computed) functions on the component.

Use any valid JS expressions, for examples:

 * `[[ index + 1 ]]`
 * `[[ ok ? 'YES' : 'NO' ]]`
 * `message.split('').reverse().join('')`
 * `_.sortBy(users, ['join', 'age'])`

## Overview
Polymer [data binding system](https://www.polymer-project.org/1.0/docs/devguide/data-system) has a limitation that only *property path* and *computed func/property* is allowed in place, although this principle is good as a fundamental building blocks that gives good performant result, productivity-wise,  it is insufficient where in most cases where simple path is insufficient and computed property is a boilerplate code to write, even all you need is as simple as  `[[ index+1 ]]` .

Purpose of this plugin is to enable you using inline JavaScript expression that are widely adopted in [many](http://docs.ractivejs.org/0.8/expressions) [other](https://vuejs.org/v2/guide/syntax.html#Using-JavaScript-Expressions) MVVM systems.

### Which kind of expression?

Valid JavaScript expression can be used, with a few regulations:

* No assignment operators (i.e. a = b, a += 1, a-- and so on);
* No new, delete, or void operators;
* No function literals (i.e. anything that involves the function keyword)
* Any path to a local scope property, including `index` and `item`  alike properties created dynamical in sub template like `dom-repeat`;
* Use of any path that are not present in the local component (either through declared properties or data binding paths) are considered as *global objects*.

## Install

```
$ npm install —save-dev gulp-polymer-expr
```


## Usage
This allows you to use any valid JS expression in one-way data binding with square brackets ( `[[ *(expr)* ]]` )

```html
<dom-module id="x-custom">

  <template>
    My name is <span>{{first + ' ' + last}}</span>
  </template>

  <script>
    Polymer({
      is: 'x-custom',
      properties: {
        first: String,
        last: String
      }
    });
  </script>

</dom-module>
```

Comparing to vanilla Polymer binding version:

```html
<dom-module id="x-custom">

  <template>
    My name is <span>{{fullName}}</span>
  </template>

  <script>
    Polymer({
      is: 'x-custom',
      computeFullName: function(first, last) {
        return first + ' ' + last;
      },
      properties: {
        first: String,
        last: String,
        fullName: {
          type: String,
          // when `first` or `last` changes `computeFullName` is called once
          // and the value it returns is stored as `fullName`
          computed: 'computeFullName(first, last)'
        }
      }
    });
  </script>

</dom-module>
```

To make the above works, your gulp task shall looks like this:

```js
const gulp = require('gulp');
const polymerExpr = require('gulp-polymer-expr');

gulp.task('compile', () => {
	gulp.src('components/**/*.html')
		.pipe(polymerExpr())
		.pipe(gulp.dest('dist'))
);
```


## Use of global objects
You can use global function call or object access in expression, e.g. if your component’s binding is using *lodash* to sort a list of data, where `list` is a valid path to the local scope, the binding  `[[ _.sortBy(list, 'created')]]` will be transpired into computed binding  `[[ __c_0(list) ]]` and yields the following computed function:

```js
Polymer({
__c_0: function(list) {
  return _.sortBy(list, ‘created’);
},
...
});
```

Note that how  `_.sortBy`  is recognized as a global object and thus doesn’t get precompiled as a parameter to the computed function.

## API

### polymerExpr([options])

#### options
N/A

## License

MIT © [Garry Yao](https://github.com/garryyao)