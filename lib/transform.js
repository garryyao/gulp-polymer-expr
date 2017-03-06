const htmlparser = require("htmlparser2");
const $ = htmlparser.DomUtils;
const Types = htmlparser.ElementType;
const jsep = require("jsep");
const esprima = require("esprima");
const esquery = require("esquery");

const ONEWAY_BINDING_EXPR = /\[\[(.+?)\]\]/g;
const TWOWAY_BINDING_EXPR = /\{\{(.+?)\}\}/g;

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

// list of identifiers in an expression string
function identifiers(str) {
  return paths(jsep(str)).map(function(path) {
    // is member path
    if (path.indexOf('.') !== 0) {
      return path.split('.')[0];
    }
    return path;
  });
}

function createComputedProp(str, node, scope) {
  const nested_scope = getElementScopeBindings(node);
  const pathnames = paths(jsep(str)).filter(function(path) {
    if (path.indexOf('.') !== 0) {
      path = path.split('.')[0];
    }
    // skip identifiers that are not in the scope
    return path in scope.bindings || path in nested_scope;
  });
  const params = pathnames.map(function(id) {
    // convert path identifier to a valid function parameter name, e.g.
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

  return `${key}(${pathnames.join(',')})`;
}
function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function getElementScopeBindings(node) {
  const scopeBindings = {};
  while (node) {
    if (node.type === Types.Tag && node.name === 'template' && node.attribs.is === 'dom-repeat') {
      let item = node.attribs.as || 'item';
      let index = node.attribs.indexAs || 'index';
      scopeBindings[item] = 1;
      scopeBindings[index] = 1;
    }
    node = node.parent;
  }
  return scopeBindings;
}

function identifierMemberExpr(expr) {
  let left_hand = expr.object;
  let ids = paths(left_hand);
  if (typeof ids === 'string') {
    return [ids, expr.property.name].join('.');
  }
  return ids;
}

function paths(expr) {
  let ids = [];
  switch(expr.type) {
    case 'Identifier':
      return [expr.name];
    case 'MemberExpression':
      let left_hand = expr.object;
      ids = paths(left_hand);
      // add to member expression
      if (ids.length === 1) {
        ids[0] = [ids[0], expr.property.name].join('.');
      }
      return ids;
    case 'CallExpression':
      return paths(expr.callee).concat(expr.arguments.map(paths).reduce(function(total, ids) {
        return total.concat(ids);
      }, ids));
    case 'UNARY_EXP':
      return paths(expr.argument);
    case 'BinaryExpression':
    case 'LogicalExpression':
      return paths(expr.left).concat(paths(expr.right));
    case 'CONDITIONAL_EXP':
      return paths(expr.test).concat(paths(expr.consequent)).concat(paths(expr.alternate));
    case 'ArrayExpression':
      return expr.elements.map(paths).reduce(function(total, ids) {
        return total.concat(ids);
      }, ids);
    case 'THIS_EXP':
      return paths(expr.object);
    default:
      return ids;
  }
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

function isValidTwoWayBinding(expr) {
  return isPropPath(expr) || isNegative(expr);
}

function isValidOneWayBinding(expr) {
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

function transformBindings(text, node, scope) {
  return text.replace(ONEWAY_BINDING_EXPR, function(match, s) {
    let expr;

    try {
       expr = jsep(s);
    } catch(er) {

      // Not a valid JS expr, try to validate in other ways
      if (!isValidJSON(match) && !isWildcardPath(s)) {
        console.error('INVALID data binding expr:', match);
      }
    }

    if (expr && !isValidOneWayBinding(expr)) {
      s = createComputedProp(s, node, scope);
      return ['[[', s, ']]'].join('');
    }
    return match;
  });
}

function collectBindings(text, node, scope) {
  let bindings = [];
  text.replace(TWOWAY_BINDING_EXPR, function(match, s) {
    let expr;

    try {
       expr = jsep(s);
    } catch(er) {

      // Not a valid JS expr, try to validate in other ways
      if (!isValidJSON(match) && !isWildcardPath(s)) {
        console.error('INVALID data binding expr:', match);
      }
    }

    if (expr && isValidTwoWayBinding(expr)) {
      bindings = bindings.concat(identifiers(s));
    }

    // shall not alter anything
    return match;
  });

  Array.prototype.push.apply(scope.bindings, bindings);
}

function createComputedBindings(scope, ast, script) {
  let code = script.data;
  // Place generated methods right after "Polymer({...});" call
  const proto = 'CallExpression[callee.type="Identifier"][callee.name="Polymer"] > ObjectExpression';
  let call_node = esquery.query(ast, proto)[0];
  let offset = call_node.range[0] + 1;
  if (offset) {
    let bindings = '\n//### auto-generated *Computed Bindings*\n';
    for (let [k, v] of Object.entries(scope)) {
      bindings += ["'" + k + "'" + ': ' + v + ',', '\n'].join('');
    }
    bindings += '//###\n';
    code = code.slice(0, offset) + bindings + code.slice(offset, code.length);
    script.data = code;
  }
}

function collectBindingsInScript(scope, ast) {
  const module_id = scope.module_id;
  // Look for the "Polymer({is: '...'});" call
  const proto = 'CallExpression[callee.type="Identifier"][callee.name="Polymer"] > ObjectExpression';

  let call_node = esquery.query(ast, proto)[0];
  let is_node = esquery.query(call_node, ':matches(* > Property[key.name="is"]) Literal')[0];
  if (!is_node) {
    return [];
  }

  const polymer_id = is_node.value;

  // make sure it's the correct Polymer factory
  if(polymer_id !== module_id) {
    console.error(`Unexpected DOM module: ${module_id} with Polymer component: ${polymer_id}`);
    return [];
  }

  // Look for definitions "Polymer({properties: '...'});"
  const def = esquery.query(call_node, '* > Property[key.name="properties"] > ObjectExpression')[0];

  if(!def) {
    return [];
  }

  return def.properties.map(function(prop) {
    return prop.key.name;
  });
}

function list2table(list) {
  return list.reduce(function(hash, name) {
      hash[name] = 1;
      return hash;
    }, {});
}

// traverse (and potentially mutate) top-level template DOM
function traverseTemplatesContent(root, scope, accessor) {
  $.filter(function templateNode(node) {
    if (isHostTemplate(node)) {
      $.filter(processNode, node.children);
      return true;
    }
  }, root);

  function isHostTemplate(node) {
    return 'template' === node.name && (
      'dom-bind' === node.attribs.is || !node.attribs.is
      );
  }

  function processNode(node) {
    // skip if it's nested template node
    if (isHostTemplate(node)) {
      return;
    }

    let text, textNew;
    // process text bindings
    if (node.type === Types.Text && (
        text = node.data.trim()
      )) {
      if (textNew = accessor(text, node, scope)) {
        node.data = textNew;
      }
    }
    // process attributes bindings
    else if (Types.isTag(node)) {
      for (let [name, value] of Object.entries(node.attribs)) {
        let valueNew;
        if ((
            valueNew = accessor(value, node, scope)
          )) {
          if(valueNew !== value) {
            node.attribs[name] = valueNew;
          }

          //valueNew !== value
          //  ? console.log('transform:', name, '=', value, '->', valueNew)
          //  : console.log('skip:', name, '=', value);
        }
      }
    }
  }
}

module.exports = function main(html, options) {
  const dom = htmlparser.parseDOM(html, {decodeEntities: true});
  let bindings = [];
  let ast;
  let polymer_script;
  const scope = {};

  const domModule = $.findOne(function moduleElement(element) {
    return 'dom-module' === element.name;
  }, dom);
  const module_id = domModule && domModule.attribs.id;

  if (module_id) {
    $.findOne(function scriptElement(element) {
      if ('script' === element.type) {
        const child = element.children && element.children[0];
        // quick parsing locate Polymer factory script
        if (child && child.type === 'text' && /Polymer\s*\(\s*\{/.test(child.data)) {
          try {
            ast = esprima.parse(child.data, {range: true});
          }
          catch (e) {
            console.error('Failed to parse module script:', module_id);
          }
          polymer_script = child;
        }
      }
    }, dom);

    Object.defineProperty(scope, 'id', {
      enumerable: false,
      configurable: false,
      writable: true,
      value: 0
    });

    Object.defineProperty(scope, 'module_id', {
      enumerable: false,
      configurable: false,
      writable: true,
      value: module_id
    });

    // Create bindings in host element scope
    Object.defineProperty(scope, 'bindings', {
      enumerable: false, configurable: false, writable: true, value: bindings
    });

    // 1. Find all binding in template
    // 2. Find all binding in "properties" definition
    traverseTemplatesContent(dom, scope, collectBindings);

    if(polymer_script) {
      Array.prototype.push.apply(scope.bindings, collectBindingsInScript(scope, ast));
    }

    // list -> hash
    scope.bindings = list2table(scope.bindings);

    // Transform all expression binding in template
    traverseTemplatesContent(dom, scope, transformBindings);
  }

  if(polymer_script) {
    createComputedBindings(scope, ast, polymer_script);
  }

  return $.getOuterHTML(dom);
}