## gulp-polymer-expr [![Build Status](https://travis-ci.org/garryyao/gulp-polymer-expr.svg?branch=master)](https://travis-ci.org/garryyao/gulp-polymer-expr)

> Syntactic sugar allows for JS expressions in Polymer [data binding annotation](https://www.polymer-project.org/1.0/docs/devguide/data-binding) , which is transpiled into [computed binding](https://www.polymer-project.org/1.0/docs/devguide/data-binding#annotated-computed) functions on the component.

You can use any valid JS expressions, for examples:

 * `[[ index + 1 ]]`
 * `[[ ok ? 'YES' : 'NO' ]]`
 * `message.split('').reverse().join('')`
 * `_.sortBy(users, ['join', 'age'])`

## Overview
Polymer [data binding system](https://www.polymer-project.org/1.0/docs/devguide/data-system) use **paths** and **observable changes** as the fundamental building blocks which gives a performant result, it also unified both single-way and two-way data flow using a singe annotation syntax.

Productivity-wise,  it is insufficient where in most cases where simple path annotation is not enough when you need to resort to **computed bindings** which turns out to be somehow verbose even all you need is simply  `[[ index+1 ]]`  - So this add-on is to support for inline JavaScript expression that is widely flavored in [many](http://docs.ractivejs.org/0.8/expressions) [other](https://vuejs.org/v2/guide/syntax.html#Using-JavaScript-Expressions) MVVM systems.

### Which kind of expression?

Valid JavaScript expression can be used, with a few regulations:

* No assignment operators (i.e. a = b, a += 1, a-- and so on);
* No new, delete, or void operators;
* No function literals (i.e. anything that involves the function keyword)
* Use Path/Sub Properties from local scope, including newly created scope like in `dom-repeat`;
* Identifiers from a subset of global objects, e.g. Math, Array, parseInt, encodeURIComponent, you can supply the list of globals via gulp plugin option `globals`;

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


## API

### polymerExpr([options])

#### options

##### globals
Type: `Array`
Default: `[]`

List of global variables identifiers that are permitted in the expression, so using these identifiers will not be transpired as computed function parameters, e.g. `[jQuery, $, _]`, default to JS globals in the following list:

```
Array
Date
JSON
Math
NaN
RegExp
decodeURI
decodeURIComponent
encodeURI
encodeURIComponent
isFinite
isNaN
null
parseFloat
parseInt
undefined
```

For example when adding `_` to the list of globals,  the data binding  `[[ _.sortBy(list, 'created')]]` will be transpired into computed binding  `[[ __c_0(list) ]]` along with the following computed function:

```js
Polymer({
__c_0: function(list) {
  return _.sortBy(list, ‘created’);
},
...
});
```

## License

MIT © [Garry Yao](https://github.com/garryyao)