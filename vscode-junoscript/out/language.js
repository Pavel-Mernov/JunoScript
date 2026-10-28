"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/language.ts
var language_exports = {};
__export(language_exports, {
  analyze: () => analyze,
  hoverAt: () => hoverAt,
  inlayHintsFor: () => inlayHintsFor,
  printType: () => printType
});
module.exports = __toCommonJS(language_exports);

// ../Lexer/lexer.ts
var keywords = /* @__PURE__ */ new Set(["let", "const", "fun", "type", "return", "if", "else", "for", "of", "while", "true", "false", "null", "readonly", "static", "as", "in", "import", "from"]);
function Lexer(source) {
  return {
    pos: 0,
    source,
    get current() {
      return source[this.pos] ?? "";
    },
    get isAtEnd() {
      return this.pos >= source.length;
    },
    tokenize() {
      const tokens = [], indents = [0];
      let line = 1, column = 1, lineStart = true;
      const push = (type, value, l = line, c = column) => {
        if (type === "Number" || type === "String") tokens.push({ type, value, line: l, column: c });
        else if (type === "Identifier" || type === "Keyword") tokens.push({ type, value: String(value), line: l, column: c });
        else tokens.push({ type, line: l, column: c });
      };
      const advance = () => {
        const c = this.current;
        this.pos++;
        if (c === "\n") {
          line++;
          column = 1;
        } else column++;
        return c;
      };
      while (!this.isAtEnd) {
        if (lineStart) {
          let width = 0;
          while (this.current === " " || this.current === "	") width += advance() === "	" ? 4 : 1;
          if (this.current === "\r") advance();
          if (this.current === "\n") {
            advance();
            push("Newline", void 0, line - 1, 1);
            continue;
          }
          if (this.current === "#") {
            while (!this.isAtEnd && source[this.pos] !== "\n") advance();
            continue;
          }
          const top = indents[indents.length - 1];
          if (width > top) {
            indents.push(width);
            push("Indent");
          } else if (width < top) {
            while (indents.length > 1 && width < indents[indents.length - 1]) {
              indents.pop();
              push("Dedent");
            }
            if (width !== indents[indents.length - 1]) throw new SyntaxError(`Inconsistent indentation at ${line}:${column}`);
          }
          lineStart = false;
        }
        const c = this.current, l = line, col = column;
        if (c === " " || c === "	" || c === "\r") {
          advance();
          continue;
        }
        if (c === "\n") {
          advance();
          push("Newline", void 0, l, col);
          lineStart = true;
          continue;
        }
        if (c === "#") {
          while (!this.isAtEnd && this.current !== "\n") advance();
          continue;
        }
        if (/[0-9]/.test(c)) {
          let raw = "";
          while (/[0-9]/.test(this.current)) raw += advance();
          if (this.current === "." && /[0-9]/.test(source[this.pos + 1] ?? "")) {
            raw += advance();
            while (/[0-9]/.test(this.current)) raw += advance();
          }
          push("Number", Number(raw), l, col);
          continue;
        }
        if (/[A-Za-z_$]/.test(c)) {
          let value = "";
          while (/[A-Za-z0-9_$]/.test(this.current)) value += advance();
          push(keywords.has(value) ? "Keyword" : "Identifier", value, l, col);
          continue;
        }
        if (c === '"' || c === "'" || c === "`") {
          const quote = advance();
          let value = "", closed = false;
          while (!this.isAtEnd) {
            const ch = advance();
            if (ch === quote) {
              closed = true;
              break;
            }
            if (ch === "\\") {
              if (this.isAtEnd) break;
              const e = advance();
              value += { n: "\n", r: "\r", t: "	", "0": "\0" }[e] ?? e;
            } else value += ch;
          }
          if (!closed) throw new SyntaxError(`Unterminated string at ${l}:${col}`);
          push("String", value, l, col);
          continue;
        }
        const pairs = { "==": "EqualEqual", "!=": "NotEqual", "<=": "LessEqual", ">=": "GreaterEqual", "=>": "FatArrow", "->": "Arrow" };
        const pair = c + (source[this.pos + 1] ?? "");
        if (pairs[pair]) {
          advance();
          advance();
          push(pairs[pair], void 0, l, col);
          continue;
        }
        const singles = { "+": "Plus", "-": "Minus", "*": "Multiply", "/": "Divide", "%": "Percent", "=": "Equal", "<": "Less", ">": "Greater", ":": "Colon", ",": "Comma", ".": "Dot", "?": "Question", "|": "Pipe", "&": "Ampersand", "!": "Bang", "(": "LeftParen", ")": "RightParen", "[": "LeftBracket", "]": "RightBracket", "{": "LeftBrace", "}": "RightBrace" };
        if (!singles[c]) throw new SyntaxError(`Unexpected character '${c}' at ${l}:${col}`);
        advance();
        push(singles[c], void 0, l, col);
      }
      if (source.length && !lineStart && tokens[tokens.length - 1]?.type !== "Newline") push("Newline", void 0, line, column);
      while (indents.length > 1) {
        indents.pop();
        push("Dedent");
      }
      push("EOF");
      return tokens;
    }
  };
}

// ../Lexer/parser.ts
var precedence = { "==": 1, "!=": 1, "<": 2, "<=": 2, ">": 2, ">=": 2, "|": 3, "&": 4, "+": 5, "-": 5, "*": 6, "/": 6, "%": 6 };
var opTypes = { EqualEqual: "==", NotEqual: "!=", Less: "<", LessEqual: "<=", Greater: ">", GreaterEqual: ">=", Pipe: "|", Ampersand: "&", Plus: "+", Minus: "-", Multiply: "*", Divide: "/", Percent: "%" };
var Parser = class {
  constructor(tokens) {
    this.tokens = tokens;
  }
  pos = 0;
  get current() {
    return this.tokens[this.pos];
  }
  is(type, value) {
    const t = this.current;
    return t.type === type && (value === void 0 || t.value === value);
  }
  take(type, message = `Expected ${type}`) {
    if (!this.is(type)) this.fail(message);
    return this.tokens[this.pos++];
  }
  value(token) {
    return token.value;
  }
  match(type, value) {
    if (!this.is(type, value)) return false;
    this.pos++;
    return true;
  }
  fail(message) {
    throw new SyntaxError(`${message} at ${this.current.line}:${this.current.column}`);
  }
  loc(token) {
    return { line: token.line, column: token.column };
  }
  identifier() {
    const token = this.take("Identifier", "Expected identifier");
    return { name: String(this.value(token)), loc: this.loc(token) };
  }
  propertyName() {
    if (this.is("Identifier") || this.is("Keyword")) {
      const token = this.tokens[this.pos++];
      return { name: String(this.value(token)), loc: this.loc(token) };
    }
    if (this.is("String")) {
      const token = this.take("String");
      return { name: String(this.value(token)), loc: this.loc(token) };
    }
    return this.identifier();
  }
  separators() {
    while (this.match("Newline") || this.match("Comma")) {
    }
  }
  objectSeparators() {
    while (this.match("Newline") || this.match("Comma") || this.match("Indent") || this.match("Dedent")) {
    }
  }
  parse() {
    const body = [];
    const topSeparators = () => {
      while (this.match("Newline") || this.match("Comma") || this.match("Dedent")) {
      }
    };
    topSeparators();
    while (!this.is("EOF")) {
      body.push(this.statement());
      topSeparators();
    }
    return body;
  }
  statement() {
    if (this.match("Keyword", "import")) return this.importStatement();
    if (this.match("Keyword", "let") || this.match("Keyword", "const")) {
      const mutable = this.value(this.tokens[this.pos - 1]) === "let", { name, loc } = this.identifier();
      const type = this.match("Colon") ? this.type() : void 0;
      let initializer;
      if (this.match("Equal")) {
        const multiline = this.match("Newline");
        if (multiline) this.take("Indent", "Expected an indented initializer");
        initializer = this.expression();
      }
      if (!initializer && !type) this.fail("A variable needs a type or initializer");
      if (!mutable && !initializer) this.fail("const requires an initializer");
      return { kind: "Variable", name, loc, mutable, type, initializer };
    }
    if (this.match("Keyword", "fun")) {
      const { name, loc } = this.identifier(), params = this.parameters(), returnType = this.match("Colon") ? this.type() : void 0;
      this.take("Equal", "Expected '=' before function body");
      return { kind: "FunctionDeclaration", name, loc, params, returnType, body: this.block() };
    }
    if (this.match("Keyword", "type")) {
      const { name, loc } = this.identifier();
      let generics = [], genericLocs = [];
      if (this.match("Less")) {
        const names = this.genericNames();
        generics = names.map((item) => item.name);
        genericLocs = names.map((item) => item.loc);
      }
      this.take("Equal", "Expected '=' in type declaration");
      const indented = this.match("Newline") && this.match("Indent");
      const value = this.type();
      if (indented) {
        this.separators();
        this.take("Dedent");
      }
      return { kind: "TypeDeclaration", name, loc, generics, genericLocs, value };
    }
    if (this.match("Keyword", "return")) return { kind: "Return", value: this.is("Newline") || this.is("Dedent") || this.is("EOF") ? void 0 : this.expression() };
    if (this.match("Keyword", "if")) {
      const condition = this.expression(), consequent = this.block();
      this.separators();
      const alternate = this.match("Keyword", "else") ? this.block() : void 0;
      return { kind: "If", condition, consequent, alternate };
    }
    if (this.match("Keyword", "while")) return { kind: "While", condition: this.expression(), body: this.block() };
    if (this.match("Keyword", "for")) {
      const mutable = this.match("Keyword", "let") || !this.match("Keyword", "const"), { name: binding, loc } = this.identifier();
      this.take("Keyword", "Expected 'of'");
      const iterable = this.expression();
      return { kind: "ForOf", binding, loc, mutable, iterable, body: this.block() };
    }
    return { kind: "ExpressionStatement", expression: this.expression() };
  }
  importStatement() {
    let defaultImport;
    let defaultImportLoc;
    const namedImports = [];
    const namedImportLocs = [];
    if (this.match("LeftBrace")) {
      if (!this.is("RightBrace")) do {
        const ident = this.identifier();
        namedImports.push(ident.name);
        namedImportLocs.push(ident.loc);
      } while (this.match("Comma"));
      this.take("RightBrace", "Expected '}' after imported names");
    } else {
      const ident = this.identifier();
      defaultImport = ident.name;
      defaultImportLoc = ident.loc;
      if (this.match("Comma")) {
        this.take("LeftBrace", "Expected '{' before named imports");
        if (!this.is("RightBrace")) do {
          const named2 = this.identifier();
          namedImports.push(named2.name);
          namedImportLocs.push(named2.loc);
        } while (this.match("Comma"));
        this.take("RightBrace", "Expected '}' after imported names");
      }
    }
    this.take("Keyword", "Expected 'from' after import names");
    const moduleToken = this.take("String", "Expected 'juno' or 'juno:node' module name");
    const module2 = this.value(moduleToken);
    if (module2 !== "juno" && module2 !== "juno:node") this.fail(`Unsupported module '${module2}'`);
    if (!defaultImport && namedImports.length === 0) this.fail("Import must name at least one binding");
    return { kind: "Import", module: module2, defaultImport, defaultImportLoc, namedImports, namedImportLocs };
  }
  block() {
    this.take("Newline", "Expected a newline before indented block");
    this.take("Indent", "Expected an indented block");
    const body = [];
    this.separators();
    while (!this.is("Dedent") && !this.is("EOF")) {
      body.push(this.statement());
      this.separators();
    }
    this.take("Dedent");
    return body;
  }
  parameters() {
    this.take("LeftParen");
    const params = [];
    while (!this.is("RightParen")) {
      const { name, loc } = this.identifier(), type = this.match("Colon") ? this.type() : void 0, defaultValue = this.match("Equal") ? this.expression() : void 0;
      params.push({ name, loc, type, defaultValue });
      if (!this.match("Comma") && !this.is("RightParen")) this.fail("Expected ',' or ')' in parameters");
    }
    this.take("RightParen");
    return params;
  }
  genericNames() {
    const names = [];
    do {
      names.push(this.identifier());
    } while (this.match("Comma"));
    this.take("Greater");
    return names;
  }
  type() {
    let left = this.typeAtom();
    while (this.is("Pipe") || this.is("Ampersand")) {
      const operator = this.current.type;
      this.pos++;
      const right = this.typeAtom();
      const kind = operator === "Pipe" ? "UnionType" : "IntersectionType";
      left = left.kind === kind ? { ...left, types: [...left.types, right] } : { kind, types: [left, right] };
    }
    return left;
  }
  typeAtom() {
    let result;
    if (this.match("LeftBrace")) {
      const members = [];
      this.objectSeparators();
      while (!this.is("RightBrace") && !this.is("EOF")) {
        const readonly = this.match("Keyword", "readonly"), constant = this.match("Keyword", "const"), { name, loc } = this.propertyName(), optional = this.match("Question");
        let params, method2 = false, type;
        if (this.is("LeftParen")) {
          method2 = true;
          params = this.parameters();
          type = this.match("Colon") ? this.type() : { kind: "NamedType", name: "void" };
        } else {
          this.take("Colon", "Expected ':' after field name");
          type = this.type();
        }
        const defaultValue = this.match("Equal") ? this.expression() : void 0;
        if (constant && defaultValue === void 0) this.fail("const type fields need a default value");
        members.push({ name, loc, optional, readonly, constant, type, defaultValue, method: method2, params });
        this.objectSeparators();
      }
      this.take("RightBrace");
      result = { kind: "ObjectType", members };
    } else if (this.match("LeftParen")) {
      const args = [];
      if (!this.is("RightParen")) do {
        args.push(this.type());
      } while (this.match("Comma"));
      this.take("RightParen");
      if (this.match("Arrow")) result = { kind: "FunctionType", params: args, result: this.type() };
      else if (args.length === 1) result = args[0];
      else this.fail("Expected function return type after ->");
    } else if (this.match("Keyword", "null")) {
      result = { kind: "NamedType", name: "null", loc: this.loc(this.tokens[this.pos - 1]) };
    } else {
      const { name, loc } = this.identifier();
      let args = [];
      if (this.match("Less")) {
        args.push(this.type());
        while (this.match("Comma")) args.push(this.type());
        this.take("Greater");
      }
      result = args.length ? { kind: "GenericType", name, args, loc } : { kind: "NamedType", name, loc };
    }
    while (this.match("LeftBracket")) {
      this.take("RightBracket");
      result = { kind: "ArrayType", element: result };
    }
    return result;
  }
  expression(min = 0) {
    let left = this.prefix();
    let typeArguments;
    while (true) {
      if (this.is("Less") && left.kind === "Identifier") {
        const saved = this.pos;
        try {
          this.pos++;
          typeArguments = [this.type()];
          while (this.match("Comma")) typeArguments.push(this.type());
          this.take("Greater");
          if (!this.is("LeftParen")) {
            this.pos = saved;
            typeArguments = void 0;
          }
        } catch {
          this.pos = saved;
          typeArguments = void 0;
        }
        if (typeArguments) continue;
      }
      if (this.match("Dot")) {
        const property = this.identifier();
        left = { kind: "Member", object: left, property: property.name, optional: false, loc: property.loc };
        continue;
      }
      if (this.match("Question") && this.match("Dot")) {
        const property = this.identifier();
        left = { kind: "Member", object: left, property: property.name, optional: true, loc: property.loc };
        continue;
      }
      if (this.match("LeftParen")) {
        const args = [];
        if (!this.is("RightParen")) do {
          args.push(this.expression());
        } while (this.match("Comma"));
        this.take("RightParen");
        left = { kind: "Call", callee: left, args, typeArguments };
        typeArguments = void 0;
        continue;
      }
      const op = opTypes[this.current.type], p = op ? precedence[op] : void 0;
      if (!op || p === void 0 || p < min) break;
      this.pos++;
      left = { kind: "Binary", operator: op, left, right: this.expression(p + 1) };
    }
    return left;
  }
  prefix() {
    if (this.match("Minus") || this.match("Bang")) {
      const token = this.tokens[this.pos - 1];
      return { kind: "Unary", operator: token.type === "Minus" ? "-" : "!", operand: this.expression(7), loc: this.loc(token) };
    }
    if (this.match("Number")) {
      const token = this.tokens[this.pos - 1];
      return { kind: "Literal", value: this.value(token), loc: this.loc(token) };
    }
    if (this.match("String")) {
      const token = this.tokens[this.pos - 1];
      return { kind: "Literal", value: this.value(token), loc: this.loc(token) };
    }
    if (this.match("Keyword", "true")) return { kind: "Literal", value: true, loc: this.loc(this.tokens[this.pos - 1]) };
    if (this.match("Keyword", "false")) return { kind: "Literal", value: false, loc: this.loc(this.tokens[this.pos - 1]) };
    if (this.match("Keyword", "null")) return { kind: "Literal", value: null, loc: this.loc(this.tokens[this.pos - 1]) };
    if (this.match("Identifier")) {
      const token = this.tokens[this.pos - 1];
      return { kind: "Identifier", name: String(this.value(token)), loc: this.loc(token) };
    }
    if (this.match("LeftParen")) {
      const value = this.expression();
      this.take("RightParen");
      return value;
    }
    if (this.match("LeftBracket")) {
      const token = this.tokens[this.pos - 1];
      const elements = [];
      if (!this.is("RightBracket")) do {
        elements.push(this.expression());
      } while (this.match("Comma"));
      this.take("RightBracket");
      return { kind: "Array", elements, loc: this.loc(token) };
    }
    if (this.match("LeftBrace")) {
      const token = this.tokens[this.pos - 1];
      const properties = [];
      this.objectSeparators();
      while (!this.is("RightBrace") && !this.is("EOF")) {
        const property = this.propertyName();
        let value;
        if (this.match("Colon")) value = this.expression();
        else if (this.match("LeftParen")) {
          this.pos--;
          const params = this.parameters();
          this.take("Equal", "Expected '=' for method body");
          value = { kind: "Function", params, body: this.block() };
        } else value = { kind: "Identifier", name: property.name, loc: property.loc };
        properties.push({ key: property.name, keyLoc: property.loc, value });
        this.objectSeparators();
      }
      this.take("RightBrace");
      return { kind: "Object", properties, loc: this.loc(token) };
    }
    if (this.match("Keyword", "fun")) {
      const params = this.parameters(), returnType = this.match("Colon") ? this.type() : void 0;
      this.take("Equal");
      return { kind: "Function", params, returnType, body: this.block() };
    }
    this.fail("Expected expression");
  }
};
function parse(source) {
  return new Parser(Lexer(source).tokenize()).parse();
}

// src/language.ts
var named = (name) => ({ kind: "NamedType", name });
var arrayOf = (element) => ({ kind: "ArrayType", element });
var optionalParam = (name, type) => ({ name, type });
function method(name, params, result) {
  return { name, optional: false, readonly: false, constant: false, method: true, params, type: result };
}
function field(name, type, readonly = false) {
  return { name, optional: false, readonly, constant: false, type };
}
function consoleType() {
  return {
    kind: "ObjectType",
    members: [
      method("log", [{ name: "data", type: named("any") }], named("void")),
      field("args", arrayOf(named("string")), true),
      method("read", [optionalParam("encoding", named("string"))], named("string")),
      method("readLines", [optionalParam("encoding", named("string"))], arrayOf(named("string")))
    ]
  };
}
function moduleType(module2) {
  return { kind: "ObjectType", members: [field("console", consoleType(), true)] };
}
function globals() {
  const env = /* @__PURE__ */ new Map();
  env.set("isType", {
    kind: "fun",
    params: [{ name: "value", type: named("any") }],
    returnType: named("boolean"),
    docs: "Returns true if `value` matches the type argument, for example `isType<number>(answer)`."
  });
  return env;
}
function printType(type) {
  switch (type.kind) {
    case "NamedType":
      return type.name;
    case "GenericType":
      return `${type.name}<${type.args.map(printType).join(", ")}>`;
    case "UnionType":
      return type.types.map(printType).join(" | ");
    case "IntersectionType":
      return type.types.map(printType).join(" & ");
    case "ArrayType": {
      const inner = printType(type.element);
      return type.element.kind === "UnionType" || type.element.kind === "IntersectionType" || type.element.kind === "FunctionType" ? `(${inner})[]` : `${inner}[]`;
    }
    case "ObjectType": {
      const members = type.members.map((member) => {
        const prefix = `${member.readonly ? "readonly " : ""}${member.constant ? "const " : ""}${member.name}${member.optional ? "?" : ""}`;
        if (member.method) return `${prefix}(${(member.params ?? []).map(printParam).join(", ")}): ${printType(member.type)}`;
        return `${prefix}: ${printType(member.type)}`;
      });
      return members.length ? `{ ${members.join(", ")} }` : "{}";
    }
    case "FunctionType":
      return `(${type.params.map(printType).join(", ")}) -> ${printType(type.result)}`;
  }
}
function printParam(param) {
  return param.type ? `${param.name}: ${printType(param.type)}` : param.name;
}
function printFunction(name, params, returnType) {
  return `fun ${name}(${params.map(printParam).join(", ")}): ${printType(returnType)}`;
}
function printSymbol(name, symbol) {
  switch (symbol.kind) {
    case "var":
      return { code: `${symbol.mutable ? "let" : "const"} ${name}: ${printType(symbol.type)}`, docs: symbol.docs };
    case "fun":
      return { code: printFunction(name, symbol.params, symbol.returnType), docs: symbol.docs };
    case "type": {
      const generics = symbol.generics.length ? `<${symbol.generics.join(", ")}>` : "";
      return { code: `type ${name}${generics} = ${printType(symbol.value)}`, docs: symbol.docs };
    }
    case "module":
      return { code: `import ${name} from '${symbol.module}'`, docs: symbol.docs };
  }
}
function instantiate(type, generics, args) {
  const map = new Map(generics.map((name, index) => [name, args[index] ?? named(name)]));
  const replace = (node) => {
    if (node.kind === "NamedType" && map.has(node.name)) return map.get(node.name);
    if (node.kind === "GenericType") return { ...node, args: node.args.map(replace) };
    if (node.kind === "UnionType" || node.kind === "IntersectionType") return { ...node, types: node.types.map(replace) };
    if (node.kind === "ArrayType") return { ...node, element: replace(node.element) };
    if (node.kind === "FunctionType") return { ...node, params: node.params.map(replace), result: replace(node.result) };
    if (node.kind === "ObjectType") return { ...node, members: node.members.map((member) => ({ ...member, type: replace(member.type) })) };
    return node;
  };
  return replace(type);
}
function resolveType(type, env) {
  if (type.kind === "NamedType") {
    const symbol = env.get(type.name);
    if (symbol?.kind === "type") return resolveType(instantiate(symbol.value, symbol.generics, []), env);
    return type;
  }
  if (type.kind === "GenericType") {
    const symbol = env.get(type.name);
    if (symbol?.kind === "type") return resolveType(instantiate(symbol.value, symbol.generics, type.args), env);
    return type;
  }
  if (type.kind === "IntersectionType") {
    const parts = type.types.map((part) => resolveType(part, env));
    const members = [];
    for (const part of parts) {
      if (part.kind === "ObjectType") members.push(...part.members);
    }
    return members.length ? { kind: "ObjectType", members } : { kind: "IntersectionType", types: parts };
  }
  return type;
}
function isFunctionSymbol(value) {
  return Boolean(value && typeof value === "object" && "kind" in value && value.kind === "fun" && "returnType" in value);
}
function lookupMember(type, name, env) {
  const resolved = resolveType(type, env);
  if (resolved.kind !== "ObjectType") return void 0;
  const member = resolved.members.find((item) => item.name === name);
  if (!member) return void 0;
  if (member.method) return { kind: "fun", params: member.params ?? [], returnType: member.type };
  return member.type;
}
function inferLiteral(value) {
  if (value === null) return named("null");
  if (typeof value === "string") return named("string");
  if (typeof value === "number") return named("number");
  return named("boolean");
}
function inferExpression(expression, env) {
  switch (expression.kind) {
    case "Literal":
      return inferLiteral(expression.value);
    case "Identifier": {
      if (expression.name === "this") {
        const self = env.get("this");
        return self?.kind === "var" ? self.type : named("any");
      }
      const symbol = env.get(expression.name);
      if (!symbol) return named("any");
      if (symbol.kind === "var") return symbol.type;
      if (symbol.kind === "fun") return { kind: "FunctionType", params: symbol.params.map((param) => param.type ?? named("any")), result: symbol.returnType };
      if (symbol.kind === "module") return moduleType(symbol.module);
      return named(expression.name);
    }
    case "Array": {
      if (!expression.elements.length) return arrayOf(named("any"));
      const elements = expression.elements.map((item) => inferExpression(item, env));
      const first = printType(elements[0]);
      return arrayOf(elements.every((item) => printType(item) === first) ? elements[0] : { kind: "UnionType", types: elements });
    }
    case "Object": {
      const members = expression.properties.map((property) => {
        if (property.value.kind === "Function") {
          return method(property.key, property.value.params, property.value.returnType ?? named("any"));
        }
        return field(property.key, inferExpression(property.value, env));
      });
      return { kind: "ObjectType", members };
    }
    case "Unary":
      return expression.operator === "-" ? named("number") : named("boolean");
    case "Binary": {
      const left = inferExpression(expression.left, env);
      const right = inferExpression(expression.right, env);
      if (["==", "!=", "<", "<=", ">", ">=", "&", "|"].includes(expression.operator)) return named("boolean");
      if (expression.operator === "+" && (left.kind === "NamedType" && left.name === "string" || right.kind === "NamedType" && right.name === "string")) return named("string");
      return named("number");
    }
    case "Member": {
      const objectType = inferExpression(expression.object, env);
      const member = lookupMember(objectType, expression.property, env);
      if (!member) return named("any");
      if (isFunctionSymbol(member)) return { kind: "FunctionType", params: member.params.map((param) => param.type ?? named("any")), result: member.returnType };
      return member;
    }
    case "Call": {
      if (expression.callee.kind === "Identifier" && expression.callee.name === "isType") return named("boolean");
      const callee = inferExpression(expression.callee, env);
      if (callee.kind === "FunctionType") return callee.result;
      if (expression.callee.kind === "Identifier") {
        const symbol = env.get(expression.callee.name);
        if (symbol?.kind === "fun") return symbol.returnType;
      }
      if (expression.callee.kind === "Member") {
        const objectType = inferExpression(expression.callee.object, env);
        const member = lookupMember(objectType, expression.callee.property, env);
        if (isFunctionSymbol(member)) return member.returnType;
      }
      return named("any");
    }
    case "Function":
      return { kind: "FunctionType", params: expression.params.map((param) => param.type ?? named("any")), result: expression.returnType ?? named("any") };
  }
}
function lengthOf(name, loc) {
  return name.length;
}
var Analyzer = class {
  hovers = [];
  hints = [];
  analyze(statements) {
    this.statements(statements, globals());
  }
  addHover(name, loc, code, docs) {
    if (!loc) return;
    this.hovers.push({ line: loc.line, column: loc.column, length: lengthOf(name, loc), code, docs });
  }
  addTypeHint(loc, name, hasType, type) {
    if (!loc || hasType) return;
    const printed = printType(type);
    this.hints.push({
      line: loc.line,
      column: loc.column + name.length,
      label: `: ${printed}`,
      tooltip: printed,
      kind: "type"
    });
  }
  addParameterHints(callee, args, env) {
    let params;
    if (callee.kind === "Identifier") {
      const symbol = env.get(callee.name);
      if (symbol?.kind === "fun") params = symbol.params;
    } else if (callee.kind === "Member") {
      const member = lookupMember(inferExpression(callee.object, env), callee.property, env);
      if (isFunctionSymbol(member)) params = member.params;
    }
    if (!params) return;
    args.forEach((arg, index) => {
      const param = params[index];
      const loc = expressionStart(arg);
      if (!param || !loc || param.name.startsWith(".")) return;
      this.hints.push({
        line: loc.line,
        column: loc.column,
        label: `${param.name}:`,
        tooltip: param.type ? `${param.name}: ${printType(param.type)}` : param.name,
        kind: "parameter"
      });
    });
  }
  bind(env, name, symbol) {
    env.set(name, symbol);
  }
  statements(statements, env) {
    for (const statement of statements) this.statement(statement, env);
  }
  statement(statement, env) {
    switch (statement.kind) {
      case "Import": {
        const imported = statement.module === "juno:node" ? "Node.js helpers for JunoScript (`console.args`, `console.read`, `console.readLines`)." : "Standard JunoScript module. `console` mirrors the host console.";
        if (statement.defaultImport) {
          const symbol = { kind: "module", module: statement.module, docs: imported };
          this.bind(env, statement.defaultImport, symbol);
          const printed = printSymbol(statement.defaultImport, symbol);
          this.addHover(statement.defaultImport, statement.defaultImportLoc, printed.code, printed.docs);
        }
        statement.namedImports.forEach((name, index) => {
          const type = name === "console" ? consoleType() : named("any");
          const symbol = {
            kind: "var",
            mutable: false,
            type,
            docs: name === "console" ? statement.module === "juno:node" ? "Console with `log`, `args`, `read`, and `readLines`." : "Host console (`log`, `error`, `warn`)." : imported
          };
          this.bind(env, name, symbol);
          const printed = printSymbol(name, symbol);
          this.addHover(name, statement.namedImportLocs?.[index], printed.code, printed.docs);
        });
        return;
      }
      case "TypeDeclaration": {
        const symbol = { kind: "type", generics: statement.generics, value: statement.value };
        this.bind(env, statement.name, symbol);
        const printed = printSymbol(statement.name, symbol);
        this.addHover(statement.name, statement.loc, printed.code, printed.docs);
        statement.generics.forEach((name, index) => this.addHover(name, statement.genericLocs?.[index], `(type parameter) ${name}`));
        this.walkType(statement.value, env);
        return;
      }
      case "Variable": {
        this.walkExpression(statement.initializer, env);
        const type = statement.type ?? (statement.initializer ? inferExpression(statement.initializer, env) : named("any"));
        const symbol = { kind: "var", mutable: statement.mutable, type };
        this.bind(env, statement.name, symbol);
        const printed = printSymbol(statement.name, symbol);
        this.addHover(statement.name, statement.loc, printed.code);
        this.addTypeHint(statement.loc, statement.name, Boolean(statement.type), type);
        if (statement.type) this.walkType(statement.type, env);
        return;
      }
      case "FunctionDeclaration": {
        const returnType = statement.returnType ?? named("any");
        const symbol = { kind: "fun", params: statement.params, returnType };
        this.bind(env, statement.name, symbol);
        const printed = printSymbol(statement.name, symbol);
        this.addHover(statement.name, statement.loc, printed.code);
        const local = new Map(env);
        for (const param of statement.params) {
          const type = param.type ?? named("any");
          this.bind(local, param.name, { kind: "var", mutable: true, type });
          this.addHover(param.name, param.loc, `(parameter) ${param.name}: ${printType(type)}`);
          this.addTypeHint(param.loc, param.name, Boolean(param.type), type);
          if (param.type) this.walkType(param.type, env);
          if (param.defaultValue) this.walkExpression(param.defaultValue, local);
        }
        if (statement.returnType) this.walkType(statement.returnType, env);
        this.statements(statement.body, local);
        return;
      }
      case "Return":
        this.walkExpression(statement.value, env);
        return;
      case "ExpressionStatement":
        this.walkExpression(statement.expression, env);
        return;
      case "If": {
        this.walkExpression(statement.condition, env);
        this.statements(statement.consequent, new Map(env));
        if (statement.alternate) this.statements(statement.alternate, new Map(env));
        return;
      }
      case "While":
        this.walkExpression(statement.condition, env);
        this.statements(statement.body, new Map(env));
        return;
      case "ForOf": {
        this.walkExpression(statement.iterable, env);
        const iterable = inferExpression(statement.iterable, env);
        const bindingType = iterable.kind === "ArrayType" ? iterable.element : named("any");
        const local = new Map(env);
        this.bind(local, statement.binding, { kind: "var", mutable: statement.mutable, type: bindingType });
        this.addHover(statement.binding, statement.loc, `${statement.mutable ? "let" : "const"} ${statement.binding}: ${printType(bindingType)}`);
        this.addTypeHint(statement.loc, statement.binding, false, bindingType);
        this.statements(statement.body, local);
        return;
      }
    }
  }
  walkType(type, env) {
    switch (type.kind) {
      case "NamedType": {
        const symbol = env.get(type.name);
        if (symbol) {
          const printed = printSymbol(type.name, symbol);
          this.addHover(type.name, type.loc, printed.code, printed.docs);
        } else this.addHover(type.name, type.loc, `(type) ${type.name}`);
        return;
      }
      case "GenericType": {
        const symbol = env.get(type.name);
        if (symbol) {
          const printed = printSymbol(type.name, symbol);
          this.addHover(type.name, type.loc, printed.code, printed.docs);
        } else this.addHover(type.name, type.loc, `(type) ${printType(type)}`);
        type.args.forEach((arg) => this.walkType(arg, env));
        return;
      }
      case "UnionType":
      case "IntersectionType":
        type.types.forEach((part) => this.walkType(part, env));
        return;
      case "ArrayType":
        this.walkType(type.element, env);
        return;
      case "FunctionType":
        type.params.forEach((param) => this.walkType(param, env));
        this.walkType(type.result, env);
        return;
      case "ObjectType":
        for (const member of type.members) {
          const signature = member.method ? `(method) ${member.name}(${(member.params ?? []).map(printParam).join(", ")}): ${printType(member.type)}` : `(property) ${member.readonly ? "readonly " : ""}${member.name}${member.optional ? "?" : ""}: ${printType(member.type)}`;
          this.addHover(member.name, member.loc, signature);
          this.walkType(member.type, env);
          for (const param of member.params ?? []) {
            const type2 = param.type ?? named("any");
            this.addHover(param.name, param.loc, `(parameter) ${param.name}: ${printType(type2)}`);
            if (param.type) this.walkType(param.type, env);
          }
        }
    }
  }
  walkExpression(expression, env, thisType) {
    if (!expression) return;
    switch (expression.kind) {
      case "Literal":
        this.addHover(literalLabel(expression.value), expression.loc, `(${printType(inferLiteral(expression.value))}) ${literalPreview(expression.value)}`);
        return;
      case "Identifier": {
        if (expression.name === "this") {
          const type = env.get("this")?.kind === "var" ? env.get("this").type : named("any");
          this.addHover("this", expression.loc, `(this) ${printType(type)}`);
          return;
        }
        const symbol = env.get(expression.name);
        if (symbol) {
          const printed = printSymbol(expression.name, symbol);
          this.addHover(expression.name, expression.loc, printed.code, printed.docs);
        }
        return;
      }
      case "Array":
        expression.elements.forEach((item) => this.walkExpression(item, env, thisType));
        return;
      case "Object": {
        const objectType = inferExpression(expression, env);
        const methodEnv = new Map(env);
        this.bind(methodEnv, "this", { kind: "var", mutable: false, type: objectType });
        for (const property of expression.properties) {
          const member = lookupMember(objectType, property.key, env);
          const code = isFunctionSymbol(member) ? `(method) ${property.key}(${member.params.map(printParam).join(", ")}): ${printType(member.returnType)}` : `(property) ${property.key}: ${printType(member && !isFunctionSymbol(member) ? member : named("any"))}`;
          this.addHover(property.key, property.keyLoc, code);
          if (property.value.kind === "Function") this.walkFunction(property.value, methodEnv);
          else this.walkExpression(property.value, env, thisType);
        }
        return;
      }
      case "Unary":
        this.walkExpression(expression.operand, env, thisType);
        return;
      case "Binary":
        this.walkExpression(expression.left, env, thisType);
        this.walkExpression(expression.right, env, thisType);
        return;
      case "Member": {
        this.walkExpression(expression.object, env, thisType);
        const objectType = inferExpression(expression.object, env);
        const member = lookupMember(objectType, expression.property, env);
        if (isFunctionSymbol(member)) {
          this.addHover(expression.property, expression.loc, `(method) ${expression.property}(${member.params.map(printParam).join(", ")}): ${printType(member.returnType)}`);
        } else if (member) {
          this.addHover(expression.property, expression.loc, `(property) ${expression.property}: ${printType(member)}`);
        }
        return;
      }
      case "Call":
        this.walkExpression(expression.callee, env, thisType);
        expression.args.forEach((arg) => this.walkExpression(arg, env, thisType));
        expression.typeArguments?.forEach((type) => this.walkType(type, env));
        this.addParameterHints(expression.callee, expression.args, env);
        return;
      case "Function":
        this.walkFunction(expression, env);
        return;
    }
  }
  walkFunction(expression, env) {
    const local = new Map(env);
    for (const param of expression.params) {
      const type = param.type ?? named("any");
      this.bind(local, param.name, { kind: "var", mutable: true, type });
      this.addHover(param.name, param.loc, `(parameter) ${param.name}: ${printType(type)}`);
      this.addTypeHint(param.loc, param.name, Boolean(param.type), type);
      if (param.type) this.walkType(param.type, env);
    }
    if (expression.returnType) this.walkType(expression.returnType, env);
    this.statements(expression.body, local);
  }
};
function literalLabel(value) {
  if (typeof value === "string") return value.length ? value : '""';
  return String(value);
}
function literalPreview(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (value === null) return "null";
  return String(value);
}
function expressionStart(expression) {
  switch (expression.kind) {
    case "Literal":
    case "Identifier":
    case "Array":
    case "Object":
    case "Unary":
      return expression.loc;
    case "Binary":
      return expressionStart(expression.left);
    case "Member":
      return expressionStart(expression.object);
    case "Call":
      return expressionStart(expression.callee);
    case "Function":
      return expression.params[0]?.loc;
  }
}
function analyze(source) {
  try {
    const analyzer = new Analyzer();
    analyzer.analyze(parse(source));
    return { hovers: analyzer.hovers, hints: analyzer.hints };
  } catch {
    return void 0;
  }
}
function hoverAt(source, line, column) {
  const result = analyze(source);
  if (!result) return void 0;
  const matches = result.hovers.filter((item) => item.line === line && column >= item.column && column <= item.column + item.length);
  return matches.sort((a, b) => a.length - b.length)[0];
}
function inlayHintsFor(source) {
  return analyze(source)?.hints ?? [];
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  analyze,
  hoverAt,
  inlayHintsFor,
  printType
});
