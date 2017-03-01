const htmlparser = require("htmlparser2");
const $ = htmlparser.DomUtils;
const Types = htmlparser.ElementType;
const jsep = require("jsep");
const esprima = require("esprima");
const esquery = require("esquery");

const BRACKET_EXPR = /\[\[(.+?)\]\]/g;
const WILDCARD_OR_ARRAYITEM = /\.[*0-9]/;
// JS expression is sand-boxed and only have access to the following *default* list of globals,
// such as Math and Date
const GLOBAL_OBJECTS = {
  'Array': 1,
  'Date': 1,
  'JSON': 1,
  'Math': 1,
  'NaN': 1,
  'RegExp': 1,
  'decodeURI': 1,
  'decodeURIComponent': 1,
  'encodeURI': 1,
  'encodeURIComponent': 1,
  'isFinite': 1,
  'isNaN': 1,
  'null': 1,
  'parseFloat': 1,
  'parseInt': 1,
  'undefined': 1
};

function uniq(list) {
  return list.filter(function(elem, pos, list) {
    return list.indexOf(elem) == pos;
  });
}

function createComputedProp(str, node, scope) {
  const ids = identifiers(jsep(str)).filter(function(id) {
    if (id.indexOf('.') !== 0) {
      id = id.split('.')[0];
    }
    return !(id in scope.globals);
  });

  const params = ids.map(function(id) {
    // transform sub property identifier, e.g.
    // foo.bar.baz -> foo__bar__baz
    if (id.indexOf('.') !== 0) {
      let rename = id.split('.').join('__')
      str = str.replace(new RegExp(id, 'g'), rename);
      return rename
    }
    return id;
  });

  let body = ['return', str.endsWith(';') ? str : str + ';'].join(' ');
  const key = '__c_' + (scope.id++);
  let func = (new (Function.prototype.bind.apply(
    Function, [null].concat(params).concat(body))
  ))
  .toString()
  .replace(/anonymous\b/, key)
  .replace(/\n\/\*\*\//, '');

  scope[key] = func;

  return `${key}(${ids.join(',')})`;
}
function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function identifierMemberExpr(expr) {
  if(expr.type === 'Identifier') {
    return expr.name;
  }
  if(expr.type === 'MemberExpression') {
    return [identifierMemberExpr(expr.object), expr.property.name].join('.');
  }
}

function identifiers(expr) {
  let ids = [];
  switch(expr.type) {
    case 'Identifier':
      ids = ids.concat(expr.name);
      break;
    case 'MemberExpression':
      ids = ids.concat(identifierMemberExpr(expr));
      break;
    case 'CallExpression':
      ids = ids.concat(identifiers(expr.callee));
      ids = expr.arguments.map(identifiers).reduce(function(total, ids) {
        return total.concat(ids);
      }, ids);
      break;
    case 'UNARY_EXP':
      ids = ids.concat(identifiers(expr.argument));
      break;
    case 'BinaryExpression':
    case 'LogicalExpression':
      ids = ids.concat(identifiers(expr.left), identifiers(expr.right));
      break;
    case 'CONDITIONAL_EXP':
      ids = ids.concat(identifiers(expr.test), identifiers(expr.consequent), identifiers(expr.alternate));
      break;
    case 'ArrayExpression':
      ids = expr.elements.map(identifiers).reduce(function(total, ids) {
        return total.concat(ids);
      }, ids);
      break;
    case 'THIS_EXP':
      ids = ids.concat(identifiers(expr.object));
      break;
  }
  return uniq(ids);
}

// A property or subproperty path (users, address.street)
function isPropPath(expr) {
  return expr.type === 'Identifier' || (
      expr.type === 'MemberExpression'
      && (!expr.object || isPropPath(expr.object))
    );
}

// A computed binding (_computeName(firstName, lastName, locale))
function isComputedFunc(expr) {
  return expr.type === 'CallExpression' && expr.callee.type === 'Identifier';
}

// Any of the above, preceded by the negation operator (!)
function isNegative(expr) {
  return expr.type === 'UnaryExpression' && expr.operator === '!' && (
    isPropPath(expr.argument) || isComputedFunc(expr.argument)
    );
}
// https://www.polymer-project.org/1.0/docs/devguide/data-binding#binding-annotation
function isPolymerBasicExpr(expr) {
  return isPropPath(expr) || isComputedFunc(expr) || isNegative(expr);
}

function isValidJSON(str) {
  try {
    JSON.parse(str);
  } catch (er) {
    return false;
  }
  return true;
}

// check for wildcard or array item accessor
// https://www.polymer-project.org/1.0/docs/devguide/data-binding#bind-array-item
function isWildcardPath(str) {
  return WILDCARD_OR_ARRAYITEM.test(str);
}

function processBindings(text, node, scope) {
  return text.replace(BRACKET_EXPR, function(match, s) {
    let expr;

    try {
       expr = jsep(s);
    } catch(er) {

      // Not a valid JS expr, try to validate in other ways
      if (!isValidJSON(match) && !isWildcardPath(s)) {
        console.error('INVALID data binding expr:', match);
      }
    }

    if (expr && !isPolymerBasicExpr(expr)) {
      s = createComputedProp(s, node, scope);
      return ['[[', s, ']]'].join('');
    }
    return match;
  });
}

function injectBindings(scope, scriptNode) {
  let code = scriptNode.data;
  const module_id = scope.module_id;
  const ast = esprima.parse(code, {range: true});

  // Look for the "Polymer({is: '...'});" call
  const proto = 'CallExpression[callee.type="Identifier"][callee.name="Polymer"] > ObjectExpression';

  let call_node = esquery.query(ast, proto)[0];
  let is_node = esquery.query(call_node, ':matches(* > Property[key.name="is"]) Literal')[0];
  const polymer_id = is_node.value;

  // make sure it's the correct Polymer factory
  if(polymer_id !== module_id) {
    console.error(`Unexpected DOM module: ${module_id} with Polymer component: ${polymer_id}`);
  }

  let offset = call_node.range[0] + 1;
  if (offset) {
    let bindings = '\n//### auto-generated *Computed Bindings*\n';
    for (let [k, v] of Object.entries(scope)) {
      bindings += ["'" + k + "'" + ': ' + v + ',', '\n'].join('');
    }
    bindings += '//###\n';
    code = code.slice(0, offset) + bindings + code.slice(offset, code.length);
    scriptNode.data = code;
  }
}

module.exports = function(html, options) {
  const dom = htmlparser.parseDOM(html, {decodeEntities: true});
  const scopeIdentifies = [];
  const domModule = $.findOne(function moduleElement(element) {
    return 'dom-module' === element.name;
  }, dom);
  const module_id = domModule.attribs.id;
  if (module_id) {
    const scope = {};

    Object.defineProperty(scope, 'id', {
      enumerable: false,
      configurable: false,
      writable: true,
      value: 0
    });

    let globals = options.globals.reduce(function(hash, name) {
      hash[name] = 1;
      return hash;
    }, {});

    globals = Object.assign(globals, GLOBAL_OBJECTS);

    // global Identifiers
    Object.defineProperty(scope, 'globals', {
      enumerable: false,
      configurable: false,
      writable: true,
      value: globals
    });

    Object.defineProperty(scope, 'module_id', {
      enumerable: false,
      configurable: false,
      writable: true,
      value: module_id
    });

    const templates = $.filter(function templateElement(element) {
      if ('template' === element.name && (
          'dom-bind' === element.attribs.is || !element.attribs.is
        )) {
        $.filter(function(node) {
          let text;
          if (node.type === Types.Text && (
              text = node.data.trim()
            )) {
            node.data = processBindings(text, node, scope);
          } else if (Types.isTag(node)) {
            const attrs = node.attribs;
            for (const [key, value] of Object.entries(attrs)) {
              attrs[key] = processBindings(value, node, scope);
            }
          }
        }, element.children);
        return true;
      }
    }, dom);
    if (Object.keys(scope).length) {
      const moduleScript = $.findOne(function scriptElement(element) {
        if ('script' === element.type) {
          const child = element.children && element.children[0];
          if (child && child.type === 'text' && /Polymer\s*\(\s*\{/.test(child.data)) {
            injectBindings(scope, child);
          }
        }
      }, dom);
    }
  }
  return $.getOuterHTML(dom);
}