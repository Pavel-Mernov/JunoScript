"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/extension.ts
var extension_exports = {};
__export(extension_exports, {
  activate: () => activate,
  deactivate: () => deactivate
});
module.exports = __toCommonJS(extension_exports);
var vscode = __toESM(require("vscode"));

// ../Lexer/lexer.ts
var keywords = /* @__PURE__ */ new Set([
  "let",
  "const",
  "fun",
  "type",
  "return",
  "if",
  "else",
  "for",
  "of",
  "while",
  "true",
  "false",
  "null",
  "readonly",
  "static",
  "as",
  "in",
  "import",
  "from"
]);
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
      const tokens = [];
      const indents = [0];
      let line = 1;
      let column = 1;
      let lineStart = true;
      const push = (type, value, l = line, c = column) => {
        if (type === "Number") {
          tokens.push({ type, value, line: l, column: c });
        } else if (type === "BigInt") {
          tokens.push({ type, value, line: l, column: c });
        } else if (type === "String") {
          tokens.push({ type, value, line: l, column: c });
        } else if (type === "Identifier" || type === "Keyword") {
          tokens.push({ type, value: String(value), line: l, column: c });
        } else {
          tokens.push({ type, line: l, column: c });
        }
      };
      const advance = () => {
        const character = this.current;
        this.pos++;
        if (character === "\n") {
          line++;
          column = 1;
        } else {
          column++;
        }
        return character;
      };
      while (!this.isAtEnd) {
        if (lineStart) {
          let width = 0;
          while (this.current === " " || this.current === "	") {
            width += advance() === "	" ? 4 : 1;
          }
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
          const currentIndent = indents[indents.length - 1];
          if (width > currentIndent) {
            indents.push(width);
            push("Indent");
          } else if (width < currentIndent) {
            while (indents.length > 1 && width < indents[indents.length - 1]) {
              indents.pop();
              push("Dedent");
            }
            if (width !== indents[indents.length - 1]) {
              throw new SyntaxError(`Inconsistent indentation at ${line}:${column}`);
            }
          }
          lineStart = false;
        }
        const character = this.current;
        const tokenLine = line;
        const tokenColumn = column;
        if (character === " " || character === "	" || character === "\r") {
          advance();
          continue;
        }
        if (character === "\n") {
          advance();
          push("Newline", void 0, tokenLine, tokenColumn);
          lineStart = true;
          continue;
        }
        if (character === "#") {
          while (!this.isAtEnd && this.current !== "\n") advance();
          continue;
        }
        if (/[0-9]/.test(character)) {
          let raw = "";
          while (/[0-9]/.test(this.current)) raw += advance();
          const isDecimal = this.current === "." && /[0-9]/.test(source[this.pos + 1] ?? "");
          if (isDecimal) {
            raw += advance();
            while (/[0-9]/.test(this.current)) raw += advance();
          }
          if (!isDecimal && this.current === "n") {
            advance();
            push("BigInt", BigInt(raw), tokenLine, tokenColumn);
          } else {
            push("Number", Number(raw), tokenLine, tokenColumn);
          }
          continue;
        }
        if (/[A-Za-z_$]/.test(character)) {
          let value = "";
          while (/[A-Za-z0-9_$]/.test(this.current)) value += advance();
          push(keywords.has(value) ? "Keyword" : "Identifier", value, tokenLine, tokenColumn);
          continue;
        }
        if (character === '"' || character === "'" || character === "`") {
          const quote = advance();
          let value = "";
          let closed = false;
          while (!this.isAtEnd) {
            const current = advance();
            if (current === quote) {
              closed = true;
              break;
            }
            if (current === "\\") {
              if (this.isAtEnd) break;
              const escaped = advance();
              value += { n: "\n", r: "\r", t: "	", "0": "\0" }[escaped] ?? escaped;
            } else {
              value += current;
            }
          }
          if (!closed) {
            throw new SyntaxError(`Unterminated string at ${tokenLine}:${tokenColumn}`);
          }
          push("String", value, tokenLine, tokenColumn);
          continue;
        }
        const pairs = {
          "==": "EqualEqual",
          "!=": "NotEqual",
          "<=": "LessEqual",
          ">=": "GreaterEqual",
          "=>": "FatArrow",
          "->": "Arrow"
        };
        const pair = character + (source[this.pos + 1] ?? "");
        if (pairs[pair]) {
          advance();
          advance();
          push(pairs[pair], void 0, tokenLine, tokenColumn);
          continue;
        }
        const singles = {
          "+": "Plus",
          "-": "Minus",
          "*": "Multiply",
          "/": "Divide",
          "%": "Percent",
          "=": "Equal",
          "<": "Less",
          ">": "Greater",
          ":": "Colon",
          ",": "Comma",
          ".": "Dot",
          "?": "Question",
          "|": "Pipe",
          "&": "Ampersand",
          "!": "Bang",
          "(": "LeftParen",
          ")": "RightParen",
          "[": "LeftBracket",
          "]": "RightBracket",
          "{": "LeftBrace",
          "}": "RightBrace"
        };
        if (!singles[character]) {
          throw new SyntaxError(`Unexpected character '${character}' at ${tokenLine}:${tokenColumn}`);
        }
        advance();
        push(singles[character], void 0, tokenLine, tokenColumn);
      }
      if (source.length && !lineStart && tokens[tokens.length - 1]?.type !== "Newline") {
        push("Newline", void 0, line, column);
      }
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
  parenthesisSeparators() {
    while (this.match("Newline") || this.match("Indent") || this.match("Dedent")) {
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
    if (this.is("Identifier") && this.tokens[this.pos + 1]?.type === "Equal") {
      const { name, loc } = this.identifier(), operatorLoc = this.loc(this.take("Equal"));
      return { kind: "ExpressionStatement", expression: { kind: "Assignment", name, loc, operatorLoc, value: this.expression() } };
    }
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
    const optional = () => {
      let value = this.typeAtom();
      if (this.match("Question")) value = { kind: "UnionType", types: [value, { kind: "NamedType", name: "null" }] };
      return value;
    };
    let left = optional();
    while (this.is("Pipe") || this.is("Ampersand")) {
      const operator = this.current.type;
      this.pos++;
      const right = optional();
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
        const readonly = this.match("Keyword", "readonly"), constant = this.match("Keyword", "const"), { name, loc } = this.propertyName();
        let optional = this.match("Question");
        let params, method2 = false, type;
        if (this.is("LeftParen")) {
          method2 = true;
          params = this.parameters();
          type = this.match("Colon") ? this.type() : { kind: "NamedType", name: "void" };
        } else {
          if (this.match("Colon")) type = this.type();
          else if (this.is("Equal")) type = { kind: "NamedType", name: "any" };
          else this.fail("Expected ':' or '=' after field name");
          if (type.kind === "UnionType") {
            const nonNull = type.types.filter((part) => !(part.kind === "NamedType" && part.name === "null"));
            if (nonNull.length === 1 && nonNull.length !== type.types.length) {
              optional = true;
              type = nonNull[0];
            }
          }
        }
        const defaultValue = this.match("Equal") ? this.expression() : void 0;
        if (constant && defaultValue === void 0) this.fail("const type fields need a default value");
        if (!method2 && defaultValue && type.kind === "NamedType" && type.name === "any") type = inferredTypeNode(defaultValue);
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
      if (this.match("LeftBracket")) {
        const token = this.tokens[this.pos - 1];
        const index = this.expression();
        this.take("RightBracket", "Expected ']' after index");
        left = { kind: "Index", object: left, index, loc: this.loc(token) };
        continue;
      }
      if (this.match("LeftParen")) {
        const args = [];
        this.parenthesisSeparators();
        if (!this.is("RightParen")) do {
          args.push(this.expression());
          this.parenthesisSeparators();
        } while (this.match("Comma") && (this.parenthesisSeparators(), true));
        this.take("RightParen");
        left = { kind: "Call", callee: left, args, typeArguments };
        typeArguments = void 0;
        continue;
      }
      const op = opTypes[this.current.type], p = op ? precedence[op] : void 0;
      if (!op || p === void 0 || p < min) break;
      const operatorToken = this.current;
      this.pos++;
      left = { kind: "Binary", operator: op, left, right: this.expression(p + 1), loc: this.loc(operatorToken) };
    }
    return left;
  }
  prefix() {
    if (this.match("Minus") || this.match("Bang")) {
      const token = this.tokens[this.pos - 1];
      return { kind: "Unary", operator: token.type === "Minus" ? "-" : "!", operand: this.expression(7), loc: this.loc(token) };
    }
    if (this.match("BigInt")) {
      const token = this.tokens[this.pos - 1];
      return { kind: "Literal", value: this.value(token), loc: this.loc(token) };
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
      const saved = this.pos - 1;
      let arrow = false;
      try {
        const params = [];
        if (!this.is("RightParen")) {
          do {
            const { name, loc } = this.identifier(), type = this.match("Colon") ? this.type() : void 0;
            params.push({ name, loc, type });
          } while (this.match("Comma"));
        }
        this.take("RightParen");
        const hasReturnType = this.match("Colon");
        const returnType = hasReturnType ? this.type() : void 0;
        if (hasReturnType && this.match("FatArrow")) {
          arrow = true;
          if (this.match("Newline")) {
            this.take("Indent", "Expected an indented function body");
            const body = [];
            this.separators();
            while (!this.is("Dedent") && !this.is("EOF")) {
              body.push(this.statement());
              this.separators();
            }
            this.take("Dedent");
            return { kind: "Function", params, returnType, body };
          }
          return { kind: "Function", params, returnType, body: [], expressionBody: this.expression() };
        }
        if (this.match("FatArrow")) {
          arrow = true;
          if (this.match("Newline")) {
            this.take("Indent", "Expected an indented function body");
            const body = [];
            this.separators();
            while (!this.is("Dedent") && !this.is("EOF")) {
              body.push(this.statement());
              this.separators();
            }
            this.take("Dedent");
            return { kind: "Function", params, returnType, body };
          }
          const expressionBody = this.expression();
          return { kind: "Function", params, returnType, body: [], expressionBody };
        }
      } catch (error) {
        if (arrow) throw error;
      }
      this.pos = saved;
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
var unknownType = { kind: "unknown" };
function primitive(name) {
  return { kind: "primitive", name };
}
function inferredTypeNode(expression) {
  switch (expression.kind) {
    case "Literal":
      return { kind: "NamedType", name: typeof expression.value === "bigint" ? "BigInt" : expression.value === null ? "null" : typeof expression.value };
    case "Array":
      return { kind: "ArrayType", element: expression.elements[0] ? inferredTypeNode(expression.elements[0]) : { kind: "NamedType", name: "any" } };
    case "Object":
      return { kind: "ObjectType", members: expression.properties.map((property) => ({ name: property.key, type: inferredTypeNode(property.value), optional: false, readonly: false, constant: false })) };
    default:
      return { kind: "NamedType", name: "any" };
  }
}
function inferExpressionType(expression, variables) {
  switch (expression.kind) {
    case "Literal":
      if (typeof expression.value === "bigint") return primitive("BigInt");
      if (typeof expression.value === "number") return primitive("number");
      if (typeof expression.value === "string") return primitive("string");
      if (typeof expression.value === "boolean") return primitive("boolean");
      return primitive("null");
    case "Identifier":
      return variables.get(expression.name) ?? unknownType;
    case "Array": {
      if (expression.elements.length === 0) return { kind: "array", element: unknownType };
      const elements = expression.elements.map((element) => inferExpressionType(element, variables));
      return { kind: "array", element: commonType(elements) };
    }
    case "Object":
      return {
        kind: "object",
        fields: new Map(expression.properties.map((property) => [
          property.key,
          inferExpressionType(property.value, variables)
        ]))
      };
    case "Unary":
      return inferExpressionType(expression.operand, variables);
    case "Member": {
      const object = inferExpressionType(expression.object, variables);
      return object.kind === "object" ? object.fields.get(expression.property) ?? unknownType : unknownType;
    }
    case "Index": {
      const object = inferExpressionType(expression.object, variables);
      const index = inferExpressionType(expression.index, variables);
      if (object.kind === "array") return object.element;
      if (object.kind === "object" && index.kind === "primitive" && (index.name === "string" || index.name === "number")) {
        if (expression.index.kind === "Literal") return object.fields.get(String(expression.index.value)) ?? unknownType;
        return object.fields.size ? commonType([...object.fields.values()]) : unknownType;
      }
      return unknownType;
    }
    case "Binary": {
      const left = inferExpressionType(expression.left, variables);
      const right = inferExpressionType(expression.right, variables);
      const operator = expression.operator;
      if (left.kind !== "primitive" || right.kind !== "primitive") return unknownType;
      const leftName = left.name, rightName = right.name;
      if (operator === "+") {
        const allowed = leftName === "number" && rightName === "number" || leftName === "string" && rightName === "string" || leftName === "BigInt" && rightName === "BigInt";
        if (!allowed) {
          throw new SyntaxError(
            `Invalid operands for '+': ${leftName} and ${rightName}. Use number + number, string + string, or BigInt + BigInt.`
          );
        }
        return left;
      }
      if (operator === "*" || operator === "/") {
        const allowed = leftName === "number" && rightName === "number" || leftName === "BigInt" && rightName === "BigInt";
        if (!allowed) {
          throw new SyntaxError(
            `Invalid operands for '${operator}': ${leftName} and ${rightName}. Both operands must be number or both must be BigInt.`
          );
        }
        return left;
      }
      if (operator === "-") {
        const allowed = leftName === "number" && rightName === "number" || leftName === "BigInt" && rightName === "BigInt";
        if (!allowed) {
          throw new SyntaxError(
            `Invalid operands for '-': ${leftName} and ${rightName}. Both operands must be number or both must be BigInt.`
          );
        }
        return left;
      }
      if (operator === "<") {
        const allowed = leftName === "number" && rightName === "number" || leftName === "BigInt" && rightName === "BigInt";
        if (!allowed) {
          throw new SyntaxError(
            `Invalid operands for '<': ${leftName} and ${rightName}. Both operands must be number or both must be BigInt.`
          );
        }
        return primitive("boolean");
      }
      if (operator === ">") {
        const allowed = leftName === "number" && rightName === "number" || leftName === "BigInt" && rightName === "BigInt";
        if (!allowed) {
          throw new SyntaxError(
            `Invalid operands for '>': ${leftName} and ${rightName}. Both operands must be number or both must be BigInt.`
          );
        }
        return primitive("boolean");
      }
      if (operator === "<=") {
        const allowed = leftName === "number" && rightName === "number" || leftName === "BigInt" && rightName === "BigInt";
        if (!allowed) {
          throw new SyntaxError(
            `Invalid operands for '<=': ${leftName} and ${rightName}. Both operands must be number or both must be BigInt.`
          );
        }
        return primitive("boolean");
      }
      if (operator === ">=") {
        const allowed = leftName === "number" && rightName === "number" || leftName === "BigInt" && rightName === "BigInt";
        if (!allowed) {
          throw new SyntaxError(
            `Invalid operands for '>=': ${leftName} and ${rightName}. Both operands must be number or both must be BigInt.`
          );
        }
        return primitive("boolean");
      }
      return unknownType;
    }
    case "Assignment":
      return unknownType;
    case "Function": {
      const result = expression.returnType ? typeFromNode(expression.returnType) : expression.expressionBody ? inferExpressionType(expression.expressionBody, variables) : inferFunctionReturnType(expression.body, variables);
      return { kind: "function", result };
    }
    case "Call": {
      const callee = inferExpressionType(expression.callee, variables);
      return callee.kind === "function" ? callee.result ?? primitive("null") : unknownType;
    }
  }
}
function commonType(types) {
  const first = types[0] ?? unknownType;
  if (types.every((type) => sameType(first, type))) return first;
  return unknownType;
}
function inferFunctionReturnType(statements, variables) {
  const returns = [];
  const collect = (body, scope) => {
    for (const statement of body) {
      if (statement.kind === "Return") returns.push(statement.value ? inferExpressionType(statement.value, scope) : primitive("null"));
      else if (statement.kind === "If") {
        collect(statement.consequent, new Map(scope));
        if (statement.alternate) collect(statement.alternate, new Map(scope));
      } else if (statement.kind === "While" || statement.kind === "ForOf") {
        collect(statement.body, new Map(scope));
      } else if (statement.kind === "Variable" && statement.initializer) {
        scope.set(statement.name, statement.type ? typeFromNode(statement.type) : inferExpressionType(statement.initializer, scope));
      }
    }
  };
  collect(statements, new Map(variables));
  return commonType(returns.length ? returns : [primitive("null")]);
}
function sameType(a, b) {
  if (a.kind !== b.kind) return false;
  if (a.kind === "primitive" && b.kind === "primitive") return a.name === b.name;
  if (a.kind === "array" && b.kind === "array") return sameType(a.element, b.element);
  if (a.kind === "object" && b.kind === "object") {
    return a.fields.size === b.fields.size && [...a.fields].every(([key, value]) => b.fields.has(key) && sameType(value, b.fields.get(key)));
  }
  return a.kind === "function" || a.kind === "unknown";
}
function typeFromNode(type, aliases = /* @__PURE__ */ new Map(), resolving = /* @__PURE__ */ new Set()) {
  if (type.kind === "NamedType") {
    const alias = aliases.get(type.name);
    if (alias && !resolving.has(type.name)) {
      const next = new Set(resolving);
      next.add(type.name);
      return typeFromNode(alias, aliases, next);
    }
    return primitive(type.name);
  }
  if (type.kind === "ArrayType") return { kind: "array", element: typeFromNode(type.element, aliases, resolving) };
  if (type.kind === "GenericType" && (type.name === "Array" || type.name === "ReadonlyArray")) {
    return { kind: "array", element: type.args[0] ? typeFromNode(type.args[0], aliases, resolving) : unknownType };
  }
  if (type.kind === "ObjectType") return { kind: "object", fields: new Map(type.members.filter((member) => !member.optional && member.defaultValue === void 0).map((member) => [member.name, typeFromNode(member.type, aliases, resolving)])) };
  if (type.kind === "FunctionType") return { kind: "function" };
  return unknownType;
}
function describeType(type) {
  if (type.kind === "primitive") return type.name;
  if (type.kind === "array") return `${describeType(type.element)}[]`;
  if (type.kind === "object") return `{ ${[...type.fields].map(([key, value]) => `${key}: ${describeType(value)}`).join(", ")} }`;
  return type.kind;
}
function isAssignable(expected, actual) {
  if (expected.kind === "unknown" || actual.kind === "unknown") return true;
  if (expected.kind !== actual.kind) return false;
  if (expected.kind === "primitive" && actual.kind === "primitive") return expected.name === actual.name;
  if (expected.kind === "array" && actual.kind === "array") return isAssignable(expected.element, actual.element);
  if (expected.kind === "object" && actual.kind === "object") {
    return [...expected.fields].every(([key, type]) => actual.fields.has(key) && isAssignable(type, actual.fields.get(key)));
  }
  return true;
}
function validateArithmeticTypes(statements, variables = /* @__PURE__ */ new Map()) {
  const aliases = /* @__PURE__ */ new Map();
  for (const statement of statements) {
    if (statement.kind === "TypeDeclaration") aliases.set(statement.name, statement.value);
  }
  for (const statement of statements) {
    switch (statement.kind) {
      case "Variable": {
        const declaredType = statement.type ? typeFromNode(statement.type, aliases) : void 0;
        const inferredType = statement.initializer ? inferExpressionType(statement.initializer, variables) : void 0;
        const type = declaredType ?? inferredType;
        if (type) variables.set(statement.name, type);
        if (statement.initializer) {
          const actual = inferExpressionType(statement.initializer, variables);
          if (declaredType && !isAssignable(declaredType, actual)) {
            throw new SyntaxError(`Cannot assign ${describeType(actual)} to ${describeType(declaredType)} for '${statement.name}'`);
          }
        }
        break;
      }
      case "ExpressionStatement":
        inferExpressionType(statement.expression, variables);
        break;
      case "Return":
        if (statement.value) inferExpressionType(statement.value, variables);
        break;
      case "If":
        inferExpressionType(statement.condition, variables);
        validateArithmeticTypes(statement.consequent, new Map(variables));
        if (statement.alternate) {
          validateArithmeticTypes(statement.alternate, new Map(variables));
        }
        break;
      case "While":
        inferExpressionType(statement.condition, variables);
        validateArithmeticTypes(statement.body, new Map(variables));
        break;
      case "ForOf":
        inferExpressionType(statement.iterable, variables);
        validateArithmeticTypes(statement.body, new Map(variables));
        break;
      case "FunctionDeclaration":
        validateArithmeticTypes(statement.body, new Map(variables));
        break;
      case "Import":
      case "TypeDeclaration":
        break;
    }
  }
}
function parse(source, options = {}) {
  const statements = new Parser(Lexer(source).tokenize()).parse();
  if (options.validate !== false) {
    validateDeclarations(statements);
    validateArithmeticTypes(statements);
  }
  return statements;
}
function validateDeclarations(statements, initialNames = /* @__PURE__ */ new Set()) {
  const names = new Set(initialNames);
  for (const statement of statements) {
    const declarations = [];
    if (statement.kind === "Import") declarations.push(...statement.defaultImport ? [statement.defaultImport] : [], ...statement.namedImports);
    else if (statement.kind === "Variable" || statement.kind === "FunctionDeclaration" || statement.kind === "TypeDeclaration") declarations.push(statement.name);
    for (const name of declarations) {
      if (names.has(name)) throw new SyntaxError(`Duplicate declaration '${name}' in the same scope`);
      names.add(name);
    }
    if (statement.kind === "If") {
      validateDeclarations(statement.consequent);
      if (statement.alternate) validateDeclarations(statement.alternate);
    } else if (statement.kind === "While" || statement.kind === "ForOf") validateDeclarations(statement.body);
    else if (statement.kind === "FunctionDeclaration") {
      const functionNames = new Set(statement.params.map((param) => param.name));
      validateDeclarations(statement.body, functionNames);
    }
  }
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
function isAssignableTo(expected, actual, env) {
  const target = resolveType(expected, env);
  const value = resolveType(actual, env);
  if (isNamedType(target, "any") || isNamedType(value, "any")) return true;
  if (target.kind === "UnionType") return target.types.some((part) => isAssignableTo(part, value, env));
  if (value.kind === "UnionType") return value.types.every((part) => isAssignableTo(target, part, env));
  if (target.kind === "ArrayType" && value.kind === "ArrayType") return isAssignableTo(target.element, value.element, env);
  if (target.kind === "ObjectType" && value.kind === "ObjectType") {
    return target.members.filter((member) => !member.optional && !member.method).every((member) => {
      const actualMember = value.members.find((item) => item.name === member.name);
      return Boolean(actualMember && isAssignableTo(member.type, actualMember.type, env));
    }) && target.members.filter((member) => !member.method).every((member) => {
      const actualMember = value.members.find((item) => item.name === member.name);
      return !actualMember || isAssignableTo(member.type, actualMember.type, env);
    });
  }
  if (target.kind !== value.kind) return false;
  if (target.kind === "NamedType" && value.kind === "NamedType") return target.name === value.name;
  if (target.kind === "GenericType" && value.kind === "GenericType") return target.name === value.name && target.args.length === value.args.length && target.args.every((item, index) => isAssignableTo(item, value.args[index], env));
  if (target.kind === "FunctionType" && value.kind === "FunctionType") return target.params.length === value.params.length && target.params.every((item, index) => isAssignableTo(item, value.params[index], env)) && isAssignableTo(target.result, value.result, env);
  return true;
}
function inferLiteral(value) {
  if (value === null) return named("null");
  if (typeof value === "string") return named("string");
  if (typeof value === "number") return named("number");
  if (typeof value === "bigint") return named("BigInt");
  return named("boolean");
}
var errorType = () => named("<Error-Type>");
function isNamedType(type, name) {
  return type.kind === "NamedType" && type.name === name;
}
function hasSameNumericType(left, right) {
  return isNamedType(left, "number") && isNamedType(right, "number") || isNamedType(left, "BigInt") && isNamedType(right, "BigInt");
}
function binaryResultType(operator, left, right) {
  if (operator === "+") {
    if (hasSameNumericType(left, right) || isNamedType(left, "string") && isNamedType(right, "string")) return left;
    return errorType();
  }
  if (["-", "*", "/", "%"].includes(operator)) return hasSameNumericType(left, right) ? left : errorType();
  if (["<", "<=", ">", ">="].includes(operator)) return hasSameNumericType(left, right) ? named("boolean") : errorType();
  if (["==", "!=", "&", "|"].includes(operator)) return named("boolean");
  return named("any");
}
function binaryErrorMessage(operator, left, right) {
  if (isNamedType(left, "<Error-Type>") || isNamedType(right, "<Error-Type>")) return void 0;
  const leftName = printType(left), rightName = printType(right);
  if (operator === "+" && !(hasSameNumericType(left, right) || isNamedType(left, "string") && isNamedType(right, "string"))) {
    return `Invalid operands for '+': ${leftName} and ${rightName}. Use number + number, string + string, or BigInt + BigInt.`;
  }
  if (["-", "*", "/", "%"].includes(operator) && !hasSameNumericType(left, right)) {
    return `Invalid operands for '${operator}': ${leftName} and ${rightName}. Both operands must be number or both must be BigInt.`;
  }
  if (["<", "<=", ">", ">="].includes(operator) && !hasSameNumericType(left, right)) {
    return `Invalid operands for '${operator}': ${leftName} and ${rightName}. Both operands must be number or both must be BigInt.`;
  }
  return void 0;
}
function inferExpression(expression, env) {
  switch (expression.kind) {
    case "Literal":
      return inferLiteral(expression.value);
    case "Assignment":
      return inferExpression(expression.value, env);
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
      return arrayOf(unionOf(elements));
    }
    case "Object": {
      const members = expression.properties.map((property) => {
        if (property.value.kind === "Function") {
          return method(property.key, property.value.params, property.value.returnType ?? named("any"));
        }
        return field(property.key, inferExpression(property.value, env));
      });
      const objectType = { kind: "ObjectType", members };
      const methodEnv = new Map(env);
      methodEnv.set("this", { kind: "var", mutable: false, type: objectType });
      for (const [index, property] of expression.properties.entries()) {
        if (property.value.kind !== "Function" || property.value.returnType) continue;
        members[index] = method(property.key, property.value.params, inferFunctionReturnType2(property.value.body, methodEnv));
      }
      return objectType;
    }
    case "Unary":
      return expression.operator === "-" ? named("number") : named("boolean");
    case "Binary": {
      const left = inferExpression(expression.left, env);
      const right = inferExpression(expression.right, env);
      return binaryResultType(expression.operator, left, right);
    }
    case "Member": {
      const objectType = inferExpression(expression.object, env);
      const resolvedObjectType = resolveType(objectType, env);
      const member = lookupMember(objectType, expression.property, env);
      if (!member) return resolvedObjectType.kind === "ObjectType" ? named("null") : named("any");
      if (isFunctionSymbol(member)) return { kind: "FunctionType", params: member.params.map((param) => param.type ?? named("any")), result: member.returnType };
      return member;
    }
    case "Index": {
      const objectType = inferExpression(expression.object, env);
      const indexType = (type) => {
        if (type.kind === "ArrayType") return type.element;
        if (type.kind === "UnionType") return unionOf(type.types.map(indexType));
        if (type.kind === "ObjectType") {
          if (expression.index.kind === "Literal") {
            const key = String(expression.index.value);
            return type.members.find((member) => member.name === key)?.type ?? named("any");
          }
          return unionOf(type.members.map((member) => member.type));
        }
        return named("any");
      };
      return indexType(objectType);
    }
    case "Call": {
      if (expression.callee.kind === "Identifier" && expression.callee.name === "isType") return named("boolean");
      if (expression.callee.kind === "Identifier" && env.get(expression.callee.name)?.kind === "type") return named(expression.callee.name);
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
      return { kind: "FunctionType", params: expression.params.map((param) => param.type ?? named("any")), result: expression.returnType ?? (expression.expressionBody ? inferExpression(expression.expressionBody, env) : inferFunctionReturnType2(expression.body, env)) };
  }
}
function inferFunctionReturnType2(statements, outer) {
  const returns = [];
  const collect = (body, env) => {
    for (const statement of body) {
      if (statement.kind === "Return") {
        returns.push(statement.value ? inferExpression(statement.value, env) : named("null"));
      } else if (statement.kind === "If") {
        collect(statement.consequent, new Map(env));
        if (statement.alternate) collect(statement.alternate, new Map(env));
      } else if (statement.kind === "While" || statement.kind === "ForOf") {
        collect(statement.body, new Map(env));
      } else if (statement.kind === "Variable") {
        env.set(statement.name, { kind: "var", mutable: statement.mutable, type: statement.type ?? (statement.initializer ? inferExpression(statement.initializer, env) : named("any")) });
      }
    }
  };
  collect(statements, new Map(outer));
  return returns.length ? unionOf(returns) : named("null");
}
function unionOf(types) {
  const flattened = types.flatMap((type) => type.kind === "UnionType" ? type.types : [type]);
  if (!flattened.length) return named("any");
  const unique = flattened.filter((type, index) => flattened.findIndex((item) => printType(item) === printType(type)) === index);
  return unique.length === 1 ? unique[0] : { kind: "UnionType", types: unique };
}
function lengthOf(name, loc) {
  return name.length;
}
var Analyzer = class {
  hovers = [];
  hints = [];
  diagnostics = [];
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
  addDiagnostic(loc, message) {
    if (!loc) return;
    this.diagnostics.push({ line: loc.line, column: loc.column, length: 1, message });
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
        if (statement.type && statement.initializer?.kind === "Object") {
          const expected = resolveType(statement.type, env);
          if (expected.kind === "ObjectType") {
            const properties = statement.initializer.properties;
            const actual = inferExpression(statement.initializer, env);
            const actualMembers = actual.kind === "ObjectType" ? actual.members : [];
            for (const property of properties) {
              const member = expected.members.find((item) => item.name === property.key);
              if (!member) continue;
              const propertyType = inferExpression(property.value, env);
              if (!isAssignableTo(member.type, propertyType, env)) {
                if (property.keyLoc) this.diagnostics.push({ line: property.keyLoc.line, column: property.keyLoc.column, length: property.key.length, message: `Type '${printType(propertyType)}' is not assignable to type '${printType(member.type)}' for '${property.key}'.` });
              }
            }
            const missing = expected.members.filter((member) => !member.optional && !member.method && !member.defaultValue && !actualMembers.some((item) => item.name === member.name));
            if (missing.length) {
              const loc = statement.initializer.kind === "Object" ? statement.initializer.loc : void 0;
              if (loc) this.diagnostics.push({
                line: loc.line,
                column: loc.column,
                length: 1,
                message: `Missing required properties: ${missing.map((member) => `'${member.name}'`).join(", ")}.`,
                fix: { title: "Fill all required properties", line: loc.line, fields: missing.map((member) => ({ name: member.name, type: printType(member.type) })) }
              });
            }
          } else if (!isAssignableTo(statement.type, inferExpression(statement.initializer, env), env)) {
            this.addDiagnostic(statement.initializer.loc, `Type '${printType(inferExpression(statement.initializer, env))}' is not assignable to type '${printType(statement.type)}'.`);
          }
        } else if (statement.type && statement.initializer && !isAssignableTo(statement.type, inferExpression(statement.initializer, env), env)) {
          this.addDiagnostic(statement.initializer.loc, `Type '${printType(inferExpression(statement.initializer, env))}' is not assignable to type '${printType(statement.type)}'.`);
        }
        const symbol = { kind: "var", mutable: statement.mutable, type };
        this.bind(env, statement.name, symbol);
        const printed = printSymbol(statement.name, symbol);
        this.addHover(statement.name, statement.loc, printed.code);
        this.addTypeHint(statement.loc, statement.name, Boolean(statement.type), type);
        if (statement.type) this.walkType(statement.type, env);
        return;
      }
      case "FunctionDeclaration": {
        const inferenceEnv = new Map(env);
        for (const param of statement.params) this.bind(inferenceEnv, param.name, { kind: "var", mutable: true, type: param.type ?? named("any") });
        const returnType = statement.returnType ?? inferFunctionReturnType2(statement.body, inferenceEnv);
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
        if (statement.expression.kind === "Assignment") {
          const symbol = env.get(statement.expression.name);
          if (symbol?.kind === "var" && !symbol.mutable) {
            const loc = statement.expression.operatorLoc;
            if (loc) this.diagnostics.push({ line: loc.line, column: loc.column, length: 1, message: `Cannot assign to constant '${statement.expression.name}'` });
          }
        }
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
      case "Binary": {
        this.walkExpression(expression.left, env, thisType);
        this.walkExpression(expression.right, env, thisType);
        const message = binaryErrorMessage(expression.operator, inferExpression(expression.left, env), inferExpression(expression.right, env));
        if (message) this.addDiagnostic(expression.loc, message);
        return;
      }
      case "Index": {
        this.walkExpression(expression.object, env, thisType);
        this.walkExpression(expression.index, env, thisType);
        if (expression.loc) {
          this.hovers.push({
            line: expression.loc.line,
            column: expression.loc.column,
            length: 1,
            code: `(infer) ${printType(inferExpression(expression, env))}`
          });
        }
        return;
      }
      case "Member": {
        this.walkExpression(expression.object, env, thisType);
        const objectType = inferExpression(expression.object, env);
        const resolvedObjectType = resolveType(objectType, env);
        const member = lookupMember(objectType, expression.property, env);
        if (isFunctionSymbol(member)) {
          this.addHover(expression.property, expression.loc, `(method) ${expression.property}(${member.params.map(printParam).join(", ")}): ${printType(member.returnType)}`);
        } else if (member) {
          this.addHover(expression.property, expression.loc, `(property) ${expression.property}: ${printType(member)}`);
        } else if (resolvedObjectType.kind === "ObjectType") {
          if (expression.loc) this.diagnostics.push({
            line: expression.loc.line,
            column: expression.loc.column,
            length: expression.property.length,
            message: `Property '${expression.property}' does not exist on type '${printType(objectType)}'.`
          });
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
    analyzer.analyze(parse(source, { validate: false }));
    return { hovers: analyzer.hovers, hints: analyzer.hints, diagnostics: analyzer.diagnostics };
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

// src/extension.ts
function activate(context) {
  const selector = { language: "junoscript", scheme: "file" };
  const diagnostics = vscode.languages.createDiagnosticCollection("junoscript");
  const updateDiagnostics = (document) => {
    if (document.languageId !== "junoscript") return;
    const result = analyze(document.getText());
    diagnostics.set(document.uri, (result?.diagnostics ?? []).map((info) => {
      const start = new vscode.Position(info.line - 1, info.column - 1);
      const end = new vscode.Position(info.line - 1, info.column - 1 + info.length);
      return new vscode.Diagnostic(new vscode.Range(start, end), info.message, vscode.DiagnosticSeverity.Error);
    }));
  };
  vscode.workspace.textDocuments.forEach(updateDiagnostics);
  context.subscriptions.push(
    diagnostics,
    vscode.workspace.onDidOpenTextDocument(updateDiagnostics),
    vscode.workspace.onDidChangeTextDocument((event) => updateDiagnostics(event.document)),
    vscode.workspace.onDidCloseTextDocument((document) => diagnostics.delete(document.uri)),
    vscode.languages.registerHoverProvider(selector, {
      provideHover(document, position) {
        const info = hoverAt(document.getText(), position.line + 1, position.character + 1);
        if (!info) return;
        const markdown = new vscode.MarkdownString();
        markdown.appendCodeblock(info.code, "junoscript");
        if (info.docs) markdown.appendMarkdown(`
${info.docs}`);
        const range = new vscode.Range(info.line - 1, info.column - 1, info.line - 1, info.column - 1 + info.length);
        return new vscode.Hover(markdown, range);
      }
    }),
    vscode.languages.registerInlayHintsProvider(selector, {
      provideInlayHints(document) {
        const config = vscode.workspace.getConfiguration("junoscript.inlayHints");
        const variableTypes = config.get("variableTypes.enabled", true);
        const parameterNames = config.get("parameterNames.enabled", true);
        return inlayHintsFor(document.getText()).flatMap((hint) => {
          if (hint.kind === "type" && !variableTypes) return [];
          if (hint.kind === "parameter" && !parameterNames) return [];
          const position = new vscode.Position(hint.line - 1, hint.column - 1);
          const item = new vscode.InlayHint(
            position,
            hint.label,
            hint.kind === "type" ? vscode.InlayHintKind.Type : vscode.InlayHintKind.Parameter
          );
          item.tooltip = new vscode.MarkdownString();
          item.tooltip.appendCodeblock(hint.tooltip, "junoscript");
          item.paddingLeft = hint.kind === "type";
          item.paddingRight = hint.kind === "parameter";
          return [item];
        });
      }
    }),
    vscode.languages.registerCodeActionsProvider(selector, {
      provideCodeActions(document, _range, context2) {
        const result = analyze(document.getText());
        if (!result) return [];
        const actions = [];
        for (const diagnostic of context2.diagnostics) {
          const info = result.diagnostics.find((item) => item.fix && item.line === diagnostic.range.start.line + 1 && item.message === diagnostic.message);
          if (!info?.fix) continue;
          const action = new vscode.CodeAction(info.fix.title, vscode.CodeActionKind.QuickFix);
          action.diagnostics = [diagnostic];
          const insertLine = Math.min(info.fix.line, document.lineCount - 1);
          const lineText = document.lineAt(insertLine).text;
          let indent = lineText.match(/^\s*/)?.[0] ?? "";
          if (lineText.trimStart().startsWith("}")) {
            const braceIndent = document.lineAt(Math.max(0, insertLine - 1)).text.match(/^\s*/)?.[0] ?? "";
            indent = `${braceIndent}    `;
          }
          const rows = info.fix.fields.map((field2) => `${indent}${field2.name}: ${placeholderFor(field2.type)},
`).join("");
          action.edit = new vscode.WorkspaceEdit();
          action.edit.insert(document.uri, new vscode.Position(insertLine, 0), rows);
          actions.push(action);
        }
        return actions;
      }
    }, { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] })
  );
}
function deactivate() {
}
function placeholderFor(type) {
  if (type === "string") return "''";
  if (type === "number" || type === "BigInt") return type === "BigInt" ? "0n" : "0";
  if (type === "boolean") return "false";
  if (type.endsWith("[]")) return "[]";
  if (type.startsWith("{")) return "{}";
  return "null";
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  activate,
  deactivate
});
//# sourceMappingURL=extension.js.map
