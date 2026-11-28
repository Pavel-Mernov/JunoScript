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
var fs = __toESM(require("node:fs"));
var path = __toESM(require("node:path"));

// ../Lexer/lexer.ts
var keywords = /* @__PURE__ */ new Set([
  "let",
  "const",
  "fun",
  "type",
  "return",
  "break",
  "if",
  "else",
  "for",
  "of",
  "while",
  "match",
  "case",
  "when",
  "true",
  "false",
  "null",
  "readonly",
  "sealed",
  "static",
  "as",
  "in",
  "import",
  "from",
  "export",
  "default",
  "constructor",
  "try",
  "catch",
  "finally",
  "await"
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
      let continuedLine = false;
      const push = (type, value, l = line, c = column) => {
        if (type === "Number") {
          tokens.push({ type, value, line: l, column: c });
        } else if (type === "BigInt") {
          tokens.push({ type, value, line: l, column: c });
        } else if (type === "String") {
          tokens.push({ type, value, line: l, column: c });
        } else if (type === "RegEx") {
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
          if (continuedLine) {
            continuedLine = false;
          } else {
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
          }
          lineStart = false;
        }
        const character = this.current;
        const tokenLine = line;
        const tokenColumn = column;
        if (source.slice(this.pos, this.pos + 3) === "...") {
          advance();
          advance();
          advance();
          push("Ellipsis", void 0, tokenLine, tokenColumn);
          continue;
        }
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
        if (character === "\\" && (source[this.pos + 1] === "\n" || source[this.pos + 1] === "\r")) {
          advance();
          if (this.current === "\r") advance();
          if (this.current === "\n") advance();
          lineStart = true;
          continuedLine = true;
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
            if (current === "\n" && quote !== "`") {
              throw new SyntaxError(`Unterminated string at ${tokenLine}:${tokenColumn}`);
            }
            if (current === quote) {
              closed = true;
              break;
            }
            if (current === "\\") {
              if (this.isAtEnd) break;
              const escaped = advance();
              value += escaped === "$" ? "\uE000" : { n: "\n", r: "\r", t: "	", "0": "\0" }[escaped] ?? escaped;
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
        if (character === "/") {
          const previous = tokens[tokens.length - 1];
          const endsExpression = previous && (["Number", "BigInt", "String", "RegEx", "Identifier", "RightParen", "RightBracket", "RightBrace", "Increment", "Decrement"].includes(previous.type) || previous.type === "Keyword" && ["true", "false", "null"].includes(previous.value));
          if (!endsExpression && source[this.pos + 1] !== "=" && source[this.pos + 1] !== "/") {
            advance();
            let pattern = "";
            let escaped = false;
            let inClass = false;
            let closed = false;
            while (!this.isAtEnd) {
              const current = advance();
              if (current === "\n" || current === "\r") throw new SyntaxError(`Unterminated regular expression at ${tokenLine}:${tokenColumn}`);
              if (!escaped && current === "[") inClass = true;
              else if (!escaped && current === "]") inClass = false;
              else if (!escaped && current === "/" && !inClass) {
                closed = true;
                break;
              }
              pattern += current;
              escaped = !escaped && current === "\\";
              if (current !== "\\") escaped = false;
            }
            if (!closed) throw new SyntaxError(`Unterminated regular expression at ${tokenLine}:${tokenColumn}`);
            let flags = "";
            while (/[A-Za-z]/.test(this.current)) flags += advance();
            try {
              new RegExp(pattern, flags);
            } catch (error) {
              throw new SyntaxError(`Invalid regular expression at ${tokenLine}:${tokenColumn}: ${error instanceof Error ? error.message : String(error)}`);
            }
            push("RegEx", { source: pattern, flags }, tokenLine, tokenColumn);
            continue;
          }
        }
        const pairs = {
          "++": "Increment",
          "--": "Decrement",
          "+=": "PlusEqual",
          "-=": "MinusEqual",
          "*=": "MultiplyEqual",
          "/=": "DivideEqual",
          "%=": "PercentEqual",
          "|=": "PipeEqual",
          "&=": "AmpersandEqual",
          "==": "EqualEqual",
          "!=": "NotEqual",
          "<=": "LessEqual",
          ">=": "GreaterEqual",
          "??": "Nullish",
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
var precedence = { "|": 1, "&": 2, "??": 3, "==": 4, "!=": 4, "<": 5, "<=": 5, ">": 5, ">=": 5, "+": 6, "-": 6, "*": 7, "/": 7, "%": 7 };
var opTypes = { EqualEqual: "==", NotEqual: "!=", Less: "<", LessEqual: "<=", Greater: ">", GreaterEqual: ">=", Nullish: "??", Pipe: "|", Ampersand: "&", Plus: "+", Minus: "-", Multiply: "*", Divide: "/", Percent: "%" };
var assignmentOperators = { Equal: "=", PlusEqual: "+=", MinusEqual: "-=", MultiplyEqual: "*=", DivideEqual: "/=", PercentEqual: "%=", PipeEqual: "|=", AmpersandEqual: "&=" };
var Parser = class _Parser {
  constructor(tokens) {
    this.tokens = tokens;
  }
  pos = 0;
  softExpressionIndents = 0;
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
    if (this.is("Number")) {
      const token = this.take("Number");
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
  parseExpressionOnly() {
    const value = this.expression();
    while (this.match("Newline")) {
    }
    if (!this.is("EOF")) this.fail("Unexpected token after expression");
    return value;
  }
  statement() {
    if (this.match("Keyword", "import")) return this.importStatement();
    if (this.match("Keyword", "export")) {
      const isDefault = this.match("Keyword", "default");
      const declaration = this.statement();
      if (!["Import", "Variable", "Destructure", "ArrayDestructure", "FunctionDeclaration", "TypeDeclaration", "ConstructorDeclaration"].includes(declaration.kind)) this.fail("export must precede a declaration");
      return { kind: "Export", declaration, default: isDefault };
    }
    if (this.match("Keyword", "let") || this.match("Keyword", "const")) {
      const mutable = this.value(this.tokens[this.pos - 1]) === "let";
      if (this.match("LeftBrace")) {
        const bindings = [];
        const patternSeparators = () => {
          while (this.match("Newline") || this.match("Indent") || this.match("Dedent")) {
          }
        };
        patternSeparators();
        while (!this.is("RightBrace")) {
          bindings.push(this.identifier());
          patternSeparators();
          if (this.match("Comma")) patternSeparators();
          else if (!this.is("RightBrace")) this.fail("Expected ',' or '}' in object destructuring");
        }
        this.take("RightBrace");
        this.take("Equal", "Expected '=' after object destructuring");
        return { kind: "Destructure", bindings, mutable, initializer: this.expression() };
      }
      if (this.match("LeftBracket")) {
        const bindings = [];
        let index = 0;
        while (!this.is("RightBracket")) {
          if (this.match("Comma")) {
            index++;
            continue;
          }
          const rest = this.match("Ellipsis");
          const binding = this.identifier();
          bindings.push({ ...binding, index, rest });
          if (rest && !this.is("RightBracket")) this.fail("A rest binding must be the last element");
          if (!rest) index++;
          if (!this.match("Comma") && !this.is("RightBracket")) this.fail("Expected ',' or ']' in array destructuring");
        }
        this.take("RightBracket");
        this.take("Equal", "Expected '=' after array destructuring");
        return { kind: "ArrayDestructure", bindings, mutable, initializer: this.expression() };
      }
      const { name, loc } = this.identifier();
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
      const { name, loc } = this.identifier();
      const genericParameters = this.match("Less") ? this.genericParameters() : [];
      const params = this.parameters(), returnType = this.match("Colon") ? this.type() : void 0;
      this.take("Equal", "Expected '=' before function body");
      const body = this.is("Keyword", "match") ? [{ kind: "Return", value: this.expression() }] : this.block();
      return {
        kind: "FunctionDeclaration",
        name,
        loc,
        generics: genericParameters.map((item) => item.name),
        genericLocs: genericParameters.map((item) => item.loc),
        genericConstraints: genericParameters.map((item) => item.constraint),
        genericDefaults: genericParameters.map((item) => item.defaultType),
        params,
        returnType,
        body
      };
    }
    if (this.match("Keyword", "type")) {
      const { name, loc } = this.identifier();
      const genericParameters = this.match("Less") ? this.genericParameters() : [];
      this.take("Equal", "Expected '=' in type declaration");
      const indented = this.match("Newline");
      if (indented && this.is("Indent") && this.tokens[this.pos + 1]?.type !== "Pipe" && this.tokens[this.pos + 1]?.type !== "Ampersand") this.pos++;
      const value = this.type();
      if (indented) {
        this.separators();
        if (this.is("Dedent")) this.take("Dedent");
      }
      return { kind: "TypeDeclaration", name, loc, generics: genericParameters.map((item) => item.name), genericLocs: genericParameters.map((item) => item.loc), genericConstraints: genericParameters.map((item) => item.constraint), genericDefaults: genericParameters.map((item) => item.defaultType), value };
    }
    if (this.match("Keyword", "constructor")) {
      const { name, loc } = this.identifier();
      const genericParameters = this.match("Less") ? this.genericParameters() : [];
      const inheritedType = this.match("Colon") ? this.type() : { kind: "ObjectType", members: [] };
      this.take("LeftBrace", "Expected '{' before constructor overloads");
      const overloads = [];
      const methods = [];
      this.objectSeparators();
      while (!this.is("RightBrace") && !this.is("EOF")) {
        this.take("Keyword", "Expected anonymous 'fun' constructor overload");
        if (this.value(this.tokens[this.pos - 1]) !== "fun") this.fail("Expected anonymous 'fun' constructor overload");
        if (!this.is("LeftParen")) {
          const method2 = this.propertyName();
          const methodGenericParameters = this.match("Less") ? this.genericParameters() : [];
          const params2 = this.parameters();
          const returnType2 = this.match("Colon") ? this.type() : void 0;
          this.take("Equal", "Expected '=' before constructor method body");
          methods.push({ kind: "FunctionDeclaration", name: method2.name, loc: method2.loc, generics: methodGenericParameters.map((item) => item.name), genericLocs: methodGenericParameters.map((item) => item.loc), genericConstraints: methodGenericParameters.map((item) => item.constraint), genericDefaults: methodGenericParameters.map((item) => item.defaultType), params: params2, returnType: returnType2, body: this.block() });
          this.objectSeparators();
          continue;
        }
        const params = this.parameters();
        const returnType = this.match("Colon") ? this.type() : void 0;
        this.take("Equal", "Expected '=' before constructor body");
        overloads.push({ kind: "Function", params, returnType, body: this.block() });
        this.objectSeparators();
      }
      this.take("RightBrace");
      if (!overloads.length) this.fail("A constructor needs at least one anonymous function");
      return { kind: "ConstructorDeclaration", name, loc, generics: genericParameters.map((item) => item.name), genericLocs: genericParameters.map((item) => item.loc), genericConstraints: genericParameters.map((item) => item.constraint), genericDefaults: genericParameters.map((item) => item.defaultType), inheritedType, overloads, methods };
    }
    if (this.match("Keyword", "return")) return { kind: "Return", value: this.is("Newline") || this.is("Dedent") || this.is("EOF") ? void 0 : this.expression() };
    if (this.match("Keyword", "break")) return { kind: "Break", loc: this.loc(this.tokens[this.pos - 1]) };
    if (this.is("Identifier") && assignmentOperators[this.tokens[this.pos + 1]?.type]) {
      const { name, loc } = this.identifier(), operatorToken = this.current, operator = assignmentOperators[operatorToken.type];
      this.pos++;
      return { kind: "ExpressionStatement", expression: { kind: "Assignment", name, loc, operatorLoc: this.loc(operatorToken), operator, value: this.expression() } };
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
    const expression = this.expression();
    const assignmentOperator = assignmentOperators[this.current.type];
    if (assignmentOperator) {
      const operatorToken = this.current;
      this.pos++;
      if (expression.kind === "Member") return { kind: "ExpressionStatement", expression: { kind: "MemberAssignment", object: expression.object, property: expression.property, propertyLoc: expression.loc, loc: this.loc(operatorToken), operator: assignmentOperator, value: this.expression() } };
      if (expression.kind === "Index") return { kind: "ExpressionStatement", expression: { kind: "MemberAssignment", object: expression.object, index: expression.index, loc: this.loc(operatorToken), operator: assignmentOperator, value: this.expression() } };
      this.fail("Only variables and object properties can be assigned here");
    }
    return { kind: "ExpressionStatement", expression };
  }
  importStatement() {
    let defaultImport;
    let defaultImportLoc;
    const namedImports = [];
    const namedImportLocs = [];
    const namedImportList = () => {
      this.parenthesisSeparators();
      while (!this.is("RightBrace")) {
        const ident = this.identifier();
        namedImports.push(ident.name);
        namedImportLocs.push(ident.loc);
        this.parenthesisSeparators();
        if (this.match("Comma")) this.parenthesisSeparators();
        else if (!this.is("RightBrace")) this.fail("Expected ',' or '}' after imported name");
      }
      this.take("RightBrace", "Expected '}' after imported names");
    };
    if (this.match("LeftBrace")) {
      namedImportList();
    } else {
      const ident = this.identifier();
      defaultImport = ident.name;
      defaultImportLoc = ident.loc;
      if (this.match("Comma")) {
        this.take("LeftBrace", "Expected '{' before named imports");
        namedImportList();
      }
    }
    this.parenthesisSeparators();
    this.take("Keyword", "Expected 'from' after import names");
    const moduleToken = this.take("String", "Expected 'juno', 'juno:node', or 'types' module name");
    const module2 = String(this.value(moduleToken));
    if (!defaultImport && namedImports.length === 0) this.fail("Import must name at least one binding");
    return { kind: "Import", module: module2, defaultImport, defaultImportLoc, namedImports, namedImportLocs };
  }
  block() {
    this.take("Newline", "Expected a newline before indented block");
    while (this.match("Newline")) {
    }
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
  matchPattern() {
    const patterns = [this.matchPatternAtom()];
    while (this.match("Pipe")) patterns.push(this.matchPatternAtom());
    return patterns.length === 1 ? patterns[0] : { kind: "PatternUnion", patterns, loc: patterns[0].loc };
  }
  matchPatternAtom() {
    if (this.match("String") || this.match("Number") || this.match("BigInt")) {
      const token2 = this.tokens[this.pos - 1];
      return { kind: "PatternLiteral", value: this.value(token2), loc: this.loc(token2) };
    }
    if (this.match("Keyword", "true") || this.match("Keyword", "false") || this.match("Keyword", "null")) {
      const token2 = this.tokens[this.pos - 1];
      const value = this.value(token2);
      return { kind: "PatternLiteral", value: value === "true" ? true : value === "false" ? false : null, loc: this.loc(token2) };
    }
    if (this.match("LeftBrace")) {
      const start = this.tokens[this.pos - 1];
      const properties = [];
      this.objectSeparators();
      while (!this.is("RightBrace")) {
        const property = this.propertyName();
        const pattern = this.match("Colon") ? this.matchPatternAtom() : void 0;
        properties.push({ name: property.name, pattern, loc: property.loc });
        this.parenthesisSeparators();
        if (this.match("Comma")) this.objectSeparators();
        else if (!this.is("RightBrace")) this.fail("Expected ',' or '}' in match object pattern");
      }
      this.take("RightBrace");
      return { kind: "PatternObject", properties, loc: this.loc(start) };
    }
    const token = this.take("Identifier", "Expected a literal, type, variable, or object pattern");
    return { kind: "PatternIdentifier", name: String(this.value(token)), nullable: this.match("Question"), loc: this.loc(token) };
  }
  matchExpression(token) {
    const value = this.expression();
    this.take("Newline", "Expected a newline after match value");
    this.take("Indent", "Expected indented match cases");
    const cases = [];
    this.separators();
    while (!this.is("Dedent") && !this.is("EOF")) {
      if (this.match("Keyword", "case")) {
        const caseToken = this.tokens[this.pos - 1];
        const pattern = this.matchPattern();
        const guard = this.match("Keyword", "when") ? this.expression() : void 0;
        cases.push({ pattern, guard, body: this.block(), loc: this.loc(caseToken) });
      } else if (this.match("Keyword", "default")) {
        const defaultToken = this.tokens[this.pos - 1];
        if (cases.some((item) => !item.pattern)) this.fail("A match expression can only have one default case");
        cases.push({ body: this.block(), loc: this.loc(defaultToken) });
      } else this.fail("Expected 'case' or 'default' in match expression");
      this.separators();
    }
    this.take("Dedent");
    return { kind: "Match", value, cases, loc: this.loc(token) };
  }
  parameters() {
    this.take("LeftParen");
    const params = [];
    let optionalSeen = false, restSeen = false;
    while (!this.is("RightParen")) {
      const ellipsis = this.is("Ellipsis");
      const rest = ellipsis || this.is("Dot") && this.tokens[this.pos + 1]?.type === "Dot" && this.tokens[this.pos + 2]?.type === "Dot";
      if (rest) this.pos += ellipsis ? 1 : 3;
      if (restSeen) this.fail("A rest parameter must be the last parameter");
      const { name, loc } = this.identifier(), type = this.match("Colon") ? this.type() : void 0, defaultValue = this.match("Equal") ? this.expression() : void 0;
      if (rest && defaultValue !== void 0) this.fail("A rest parameter cannot have a default value");
      if (rest && !type) this.fail("A rest parameter must have an array type");
      if (rest && type && type.kind !== "NamedType" && type.kind !== "ArrayType" && !(type.kind === "GenericType" && (type.name === "Array" || type.name === "ReadonlyArray"))) this.fail("A rest parameter must have an array type or an array-constrained generic type");
      if (!rest && defaultValue !== void 0) optionalSeen = true;
      else if (!rest && optionalSeen) this.fail("Parameters with default values must follow parameters without default values");
      params.push({ name, loc, type, defaultValue, rest });
      restSeen ||= rest;
      if (!this.match("Comma") && !this.is("RightParen")) this.fail("Expected ',' or ')' in parameters");
    }
    this.take("RightParen");
    return params;
  }
  genericParameters() {
    const parameters = [];
    let defaultSeen = false;
    do {
      const parameter = this.identifier();
      const constraint = this.match("Identifier", "is") ? this.type() : void 0;
      const defaultType = this.match("Equal") ? this.type() : void 0;
      if (defaultType) defaultSeen = true;
      else if (defaultSeen) this.fail("Required generic parameters must precede defaulted generic parameters");
      parameters.push({ ...parameter, constraint, defaultType });
    } while (this.match("Comma"));
    this.take("Greater");
    return parameters;
  }
  type(stopAtConditionalQuestion = false) {
    while (this.match("Newline") || this.match("Indent")) {
    }
    if (this.is("Pipe") || this.is("Ampersand")) {
      const operator = this.current.type;
      const parts = [];
      while (this.is(operator)) {
        this.pos++;
        while (this.match("Newline") || this.match("Indent")) {
        }
        parts.push(this.typeAtom());
        while (this.match("Newline")) {
        }
      }
      const kind = operator === "Pipe" ? "UnionType" : "IntersectionType";
      return parts.length === 1 ? parts[0] : { kind, types: parts };
    }
    const optional = () => {
      let value = this.typeAtom();
      if (!stopAtConditionalQuestion && this.match("Question")) value = { kind: "UnionType", types: [value, { kind: "NamedType", name: "null" }] };
      return value;
    };
    let left = optional();
    while (this.is("Pipe") || this.is("Ampersand") || this.is("Newline") && (this.tokens[this.pos + 1]?.type === "Pipe" || this.tokens[this.pos + 1]?.type === "Ampersand") || this.is("Newline") && this.tokens[this.pos + 1]?.type === "Indent" && (this.tokens[this.pos + 2]?.type === "Pipe" || this.tokens[this.pos + 2]?.type === "Ampersand")) {
      while (this.match("Newline") || this.match("Indent")) {
      }
      const operator = this.current.type;
      if (operator !== "Pipe" && operator !== "Ampersand") break;
      this.pos++;
      while (this.match("Newline") || this.match("Indent")) {
      }
      const right = optional(), kind = operator === "Pipe" ? "UnionType" : "IntersectionType";
      left = left.kind === kind ? { ...left, types: [...left.types, right] } : { kind, types: [left, right] };
    }
    if (this.match("Identifier", "is")) {
      const token = this.tokens[this.pos - 1];
      const target = this.type(true);
      if (left.kind !== "NamedType" || target.kind !== "NamedType") this.fail("'is' type operands must be type names");
      if (this.match("Question")) {
        const consequent = this.type();
        this.take("Colon", "Expected ':' in conditional type");
        return { kind: "ConditionalType", check: left, target, consequent, alternate: this.type(), loc: this.loc(token) };
      }
      return { kind: "ConditionalType", check: left, target, consequent: { kind: "LiteralType", value: true }, alternate: { kind: "LiteralType", value: false }, loc: this.loc(token) };
    }
    return left;
  }
  typeAtom() {
    let result;
    if (this.is("Identifier", "typeof") && this.tokens[this.pos + 1]?.type === "Less") {
      const token = this.take("Identifier");
      this.take("Less");
      const expression = this.expression(6);
      const typeQueryExpression = (value) => value.kind === "Identifier" || value.kind === "Member" && typeQueryExpression(value.object) || value.kind === "Index" && typeQueryExpression(value.object) && (value.index.kind === "Identifier" || value.index.kind === "Literal");
      if (!typeQueryExpression(expression)) this.fail("typeof<> only accepts an identifier, member, or indexed access");
      this.take("Greater", "Expected '>' after typeof expression");
      result = { kind: "TypeOfType", expression, loc: this.loc(token) };
    } else if (this.match("Minus")) {
      const minus = this.tokens[this.pos - 1];
      const number = this.take("Number", "Expected a number after '-' in literal type");
      result = { kind: "LiteralType", value: -this.value(number), loc: this.loc(minus) };
    } else if (this.match("Number")) {
      const token = this.tokens[this.pos - 1];
      result = { kind: "LiteralType", value: this.value(token), loc: this.loc(token) };
    } else if (this.match("String")) {
      const token = this.tokens[this.pos - 1];
      result = { kind: "LiteralType", value: this.value(token), loc: this.loc(token) };
    } else if (this.match("Keyword", "true") || this.match("Keyword", "false")) {
      const token = this.tokens[this.pos - 1];
      result = { kind: "LiteralType", value: this.value(token) === "true", loc: this.loc(token) };
    } else if (this.match("LeftBrace")) {
      const members = [];
      this.objectSeparators();
      while (!this.is("RightBrace") && !this.is("EOF")) {
        if (this.match("LeftBracket")) {
          const key = this.identifier();
          this.take("Colon", "Expected ':' after index parameter");
          const indexType = this.type();
          this.take("RightBracket", "Expected ']' after index parameter type");
          this.take("Colon", "Expected ':' before indexed value type");
          const valueType = this.type();
          members.push({ name: key.name, loc: key.loc, type: valueType, indexType, optional: false, readonly: false, constant: false });
          this.objectSeparators();
          continue;
        }
        let readonly = false, sealed = false, constant = false;
        while (this.is("Keyword") && ["readonly", "sealed", "const"].includes(String(this.value(this.current)))) {
          const modifier = String(this.value(this.tokens[this.pos++]));
          if (modifier === "readonly") readonly = true;
          else if (modifier === "sealed") sealed = true;
          else constant = true;
        }
        const explicitFunction = this.match("Keyword", "fun");
        const accessor = this.is("Identifier") && ["get", "set"].includes(String(this.value(this.current))) && this.tokens[this.pos + 1]?.type === "Identifier" ? String(this.value(this.tokens[this.pos++])) : void 0;
        const anonymousFunction = explicitFunction && this.is("LeftParen");
        const { name, loc } = anonymousFunction ? { name: "", loc: this.loc(this.tokens[this.pos - 1]) } : this.propertyName();
        const genericParameters = !anonymousFunction && this.match("Less") ? this.genericParameters() : [];
        let optional = this.match("Question");
        let params, method2 = false, type, body;
        if (this.is("LeftParen")) {
          method2 = true;
          params = this.parameters();
          const returnType = this.match("Colon") ? this.type() : void 0;
          if (this.match("Equal")) {
            body = this.is("Newline") ? this.block() : [{ kind: "Return", value: this.expression() }];
            const last = body.at(-1);
            if (anonymousFunction && last?.kind === "ExpressionStatement") {
              body[body.length - 1] = { kind: "Return", value: last.expression };
            }
            type = returnType ?? { kind: "NamedType", name: "any" };
          } else type = returnType ?? { kind: "NamedType", name: "void" };
        } else {
          if (explicitFunction) this.fail("Expected '(' after object function name");
          if (this.match("Colon")) type = this.type();
          else if (this.is("Equal")) type = { kind: "NamedType", name: "any" };
          else this.fail("Expected ':' or '=' after field name");
        }
        const defaultValue = this.match("Equal") ? this.expression() : void 0;
        if (constant && defaultValue === void 0) this.fail("const type fields need a default value");
        if (!method2 && defaultValue && type.kind === "NamedType" && type.name === "any") type = inferredTypeNode(defaultValue);
        if (accessor === "get" && params?.length) this.fail("A getter cannot have parameters");
        if (accessor === "set" && params?.length !== 1) this.fail("A setter must have exactly one parameter");
        const accessorType = accessor === "set" ? params?.[0]?.type ?? { kind: "NamedType", name: "any" } : type;
        members.push({ name, loc, optional, readonly, sealed, constant, type: accessorType, defaultValue, method: method2, accessor, generics: genericParameters.map((item) => item.name), genericLocs: genericParameters.map((item) => item.loc), genericConstraints: genericParameters.map((item) => item.constraint), genericDefaults: genericParameters.map((item) => item.defaultType), params, body });
        this.objectSeparators();
      }
      this.take("RightBrace");
      result = { kind: "ObjectType", members };
    } else if (this.match("LeftParen")) {
      const args = [];
      let rest;
      if (!this.is("RightParen")) do {
        if (rest) this.fail("A rest parameter must be the last parameter");
        const variadic = this.match("Ellipsis");
        if (this.is("Identifier") && this.tokens[this.pos + 1]?.type === "Colon") this.pos += 2;
        const argument = this.type();
        if (variadic) rest = argument;
        else args.push(argument);
      } while (this.match("Comma"));
      this.take("RightParen");
      if (this.match("Arrow") || this.match("FatArrow")) result = { kind: "FunctionType", params: args, ...rest ? { rest } : {}, result: this.type() };
      else if (!rest && args.length === 1) result = args[0];
      else this.fail("Expected function return type after -> or =>");
    } else if (this.match("LeftBracket")) {
      const elements = [];
      if (!this.is("RightBracket")) do {
        elements.push(this.type());
      } while (this.match("Comma") && !this.is("RightBracket"));
      this.take("RightBracket", "Expected ']' after tuple type");
      result = { kind: "GenericType", name: "Tuple", args: elements };
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
      const bracket = this.tokens[this.pos - 1];
      if (this.match("RightBracket")) result = { kind: "ArrayType", element: result };
      else {
        const index = this.type();
        this.take("RightBracket", "Expected ']' after indexed access type");
        result = { kind: "IndexedAccessType", object: result, index, loc: this.loc(bracket) };
      }
    }
    return result;
  }
  expression(min = 0) {
    let left = this.prefix();
    let typeArguments;
    let continuationIndents = 0;
    const continuationLine = (requireDot) => {
      if (!this.is("Newline")) return false;
      const saved = this.pos;
      while (this.match("Newline")) {
      }
      const indented = this.match("Indent");
      if (requireDot && !this.is("Dot")) {
        this.pos = saved;
        return false;
      }
      if (indented) continuationIndents++;
      return true;
    };
    while (true) {
      if (continuationLine(true)) continue;
      if (this.is("Less") && (left.kind === "Identifier" || left.kind === "Member" || left.kind === "Function" || left.kind === "Call")) {
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
        continuationLine(false);
        const property = this.propertyName();
        left = { kind: "Member", object: left, property: property.name, optional: false, loc: property.loc };
        continue;
      }
      if (this.is("Question") && this.tokens[this.pos + 1]?.type === "Dot") {
        this.pos += 2;
        const property = this.propertyName();
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
          if (this.match("Ellipsis")) {
            const token = this.tokens[this.pos - 1];
            args.push({ kind: "Spread", value: this.expression(), loc: this.loc(token) });
          } else args.push(this.expression());
          this.parenthesisSeparators();
        } while (this.match("Comma") && (this.parenthesisSeparators(), true));
        this.take("RightParen");
        left = { kind: "Call", callee: left, args, typeArguments };
        typeArguments = void 0;
        continue;
      }
      if (this.match("Bang")) {
        const token = this.tokens[this.pos - 1];
        left = { kind: "Unary", operator: "postfix!", operand: left, loc: this.loc(token) };
        continue;
      }
      if (this.match("Increment") || this.match("Decrement")) {
        const token = this.tokens[this.pos - 1];
        if (!["Identifier", "Member", "Index"].includes(left.kind)) this.fail("Increment and decrement require an assignable target");
        left = { kind: "Unary", operator: token.type === "Increment" ? "postfix++" : "postfix--", operand: left, loc: this.loc(token) };
        continue;
      }
      if (this.is("Question") && min <= 0) {
        const token = this.current;
        this.pos++;
        const consequent = this.expression();
        this.take("Colon", "Expected ':' in conditional expression");
        const alternate = this.expression();
        left = { kind: "Conditional", condition: left, consequent, alternate, loc: this.loc(token) };
        continue;
      }
      if (this.softExpressionIndents > 0 && this.is("Newline")) {
        const saved = this.pos;
        while (this.match("Newline")) {
        }
        let consumed = 0;
        while (consumed < this.softExpressionIndents && this.match("Dedent")) consumed++;
        if (consumed > 0) {
          this.softExpressionIndents -= consumed;
          break;
        }
        this.pos = saved;
      }
      if (continuationIndents > 0 && this.is("Newline")) {
        while (this.match("Newline")) {
        }
        while (continuationIndents > 0 && this.match("Dedent")) continuationIndents--;
        if (continuationIndents === 0) break;
      }
      const op = opTypes[this.current.type], p = op ? precedence[op] : void 0;
      if (!op || p === void 0 || p < min) break;
      const operatorToken = this.current;
      this.pos++;
      left = { kind: "Binary", operator: op, left, right: this.expression(p + 1), loc: this.loc(operatorToken) };
    }
    return left;
  }
  templateExpression(value, loc) {
    const parts = [];
    let cursor = 0;
    while (cursor < value.length) {
      const start = value.indexOf("${", cursor);
      if (start < 0) {
        parts.push(value.slice(cursor).replace(/\uE000/g, "$"));
        break;
      }
      if (start > cursor) parts.push(value.slice(cursor, start).replace(/\uE000/g, "$"));
      let depth = 1, quote = "", escaped = false, end = start + 2;
      for (; end < value.length; end++) {
        const char = value[end];
        if (escaped) {
          escaped = false;
          continue;
        }
        if (char === "\\") {
          escaped = true;
          continue;
        }
        if (quote) {
          if (char === quote) quote = "";
          continue;
        }
        if (char === '"' || char === "'" || char === "`") {
          quote = char;
          continue;
        }
        if (char === "{") depth++;
        else if (char === "}" && --depth === 0) break;
      }
      if (depth !== 0) this.fail("Unterminated string interpolation");
      const rawSource = value.slice(start + 2, end);
      const leadingWhitespace = rawSource.length - rawSource.trimStart().length;
      const source = rawSource.trim();
      if (!source) this.fail("String interpolation cannot be empty");
      const expression = new _Parser(Lexer(source).tokenize()).parseExpressionOnly();
      const offset = start + 2 + leadingWhitespace;
      const shiftLoc = (loc2) => {
        if (!loc2) return loc2;
        const absoluteOffset = offset + loc2.column - 1;
        const before = value.slice(0, absoluteOffset);
        const lastNewline = before.lastIndexOf("\n");
        return {
          line: loc2.line + (before.match(/\n/g)?.length ?? 0),
          column: (lastNewline < 0 ? loc2.column + offset : absoluteOffset - lastNewline) + (loc2.line > 1 ? loc2.column - 1 : 0)
        };
      };
      const shiftExpression = (node) => {
        if ("loc" in node) node.loc = shiftLoc(node.loc);
        switch (node.kind) {
          case "Template":
            for (const part of node.parts) if (typeof part !== "string") shiftExpression(part);
            break;
          case "RegEx":
            break;
          case "Array":
            node.elements.forEach(shiftExpression);
            break;
          case "Spread":
            shiftExpression(node.value);
            break;
          case "Object":
            for (const property of node.properties) {
              property.keyLoc = shiftLoc(property.keyLoc);
              shiftExpression(property.value);
            }
            break;
          case "Unary":
            shiftExpression(node.operand);
            break;
          case "Assignment":
            shiftExpression(node.value);
            break;
          case "MemberAssignment":
            node.propertyLoc = shiftLoc(node.propertyLoc);
            shiftExpression(node.object);
            if (node.index) shiftExpression(node.index);
            shiftExpression(node.value);
            break;
          case "Binary":
            shiftExpression(node.left);
            shiftExpression(node.right);
            break;
          case "Conditional":
            shiftExpression(node.condition);
            shiftExpression(node.consequent);
            shiftExpression(node.alternate);
            break;
          case "Match":
            shiftExpression(node.value);
            node.cases.forEach((item) => {
              if (item.guard) shiftExpression(item.guard);
              item.body.forEach(shiftStatement);
            });
            break;
          case "Try":
            if (node.value) shiftExpression(node.value);
            node.body?.forEach(shiftStatement);
            node.catches.forEach((item) => item.body.forEach(shiftStatement));
            node.finallyBody?.forEach(shiftStatement);
            break;
          case "Member":
            shiftExpression(node.object);
            break;
          case "Index":
            shiftExpression(node.object);
            shiftExpression(node.index);
            break;
          case "Call":
            shiftExpression(node.callee);
            node.args.forEach(shiftExpression);
            break;
          case "Function":
            for (const param of node.params) {
              param.loc = shiftLoc(param.loc);
              if (param.defaultValue) shiftExpression(param.defaultValue);
            }
            node.body.forEach(shiftStatement);
            if (node.expressionBody) shiftExpression(node.expressionBody);
            break;
        }
      };
      const shiftStatement = (statement) => {
        if ("loc" in statement) statement.loc = shiftLoc(statement.loc);
        switch (statement.kind) {
          case "Variable":
            if (statement.initializer) shiftExpression(statement.initializer);
            break;
          case "ExpressionStatement":
            shiftExpression(statement.expression);
            break;
          case "Return":
            if (statement.value) shiftExpression(statement.value);
            break;
          case "Break":
            statement.loc = shiftLoc(statement.loc);
            break;
          case "If":
            shiftExpression(statement.condition);
            statement.consequent.forEach(shiftStatement);
            statement.alternate?.forEach(shiftStatement);
            break;
          case "ForOf":
            shiftExpression(statement.iterable);
            statement.body.forEach(shiftStatement);
            break;
          case "While":
            shiftExpression(statement.condition);
            statement.body.forEach(shiftStatement);
            break;
          case "FunctionDeclaration":
            statement.body.forEach(shiftStatement);
            break;
          case "TypeDeclaration":
            break;
          case "Import":
            break;
        }
      };
      shiftExpression(expression);
      parts.push(expression);
      cursor = end + 1;
    }
    if (!parts.length) parts.push(value.replace(/\uE000/g, "$"));
    return { kind: "Template", parts, loc };
  }
  prefix() {
    if (this.match("Keyword", "try")) return this.tryExpression(this.tokens[this.pos - 1]);
    if (this.match("Keyword", "match")) return this.matchExpression(this.tokens[this.pos - 1]);
    if (this.match("Keyword", "await")) {
      const token = this.tokens[this.pos - 1];
      return { kind: "Unary", operator: "await", operand: this.expression(7), loc: this.loc(token) };
    }
    if (this.match("Increment") || this.match("Decrement")) {
      const token = this.tokens[this.pos - 1];
      const operand = this.expression(8);
      if (!["Identifier", "Member", "Index"].includes(operand.kind)) this.fail("Increment and decrement require an assignable target");
      return { kind: "Unary", operator: token.type === "Increment" ? "prefix++" : "prefix--", operand, loc: this.loc(token) };
    }
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
      const value = this.value(token);
      return value.includes("${") ? this.templateExpression(value, this.loc(token)) : { kind: "Literal", value: value.replace(/\uE000/g, "$"), loc: this.loc(token) };
    }
    if (this.match("RegEx")) {
      const token = this.tokens[this.pos - 1];
      return { kind: "RegEx", source: token.value.source, flags: token.value.flags, loc: this.loc(token) };
    }
    if (this.match("Keyword", "true")) return { kind: "Literal", value: true, loc: this.loc(this.tokens[this.pos - 1]) };
    if (this.match("Keyword", "false")) return { kind: "Literal", value: false, loc: this.loc(this.tokens[this.pos - 1]) };
    if (this.match("Keyword", "null")) return { kind: "Literal", value: null, loc: this.loc(this.tokens[this.pos - 1]) };
    if (this.match("Identifier")) {
      const token = this.tokens[this.pos - 1];
      const name = String(this.value(token));
      const loc = this.loc(token);
      if (this.match("FatArrow")) {
        const params = [{ name, loc }];
        if (this.match("Newline")) {
          this.take("Indent", "Expected an indented function body");
          const body = [];
          this.separators();
          while (!this.is("Dedent") && !this.is("EOF")) {
            body.push(this.statement());
            this.separators();
          }
          this.take("Dedent");
          return { kind: "Function", params, body };
        }
        return { kind: "Function", params, body: [], expressionBody: this.expression() };
      }
      return { kind: "Identifier", name, loc };
    }
    if (this.is("LeftParen") || this.is("Less")) {
      const opening = this.current;
      const generic = this.match("Less");
      const generics = generic ? this.genericParameters() : [];
      const saved = this.pos;
      let arrow = false;
      try {
        const params = this.parameters();
        const returnType = this.match("Colon") ? this.type() : void 0;
        const newlineArrowBody = () => {
          this.take("Indent", "Expected an indented function body");
          let depth = 0, expressionBody = false;
          for (let index = this.pos; index < this.tokens.length; index++) {
            const type = this.tokens[index].type;
            if (type === "LeftParen" || type === "LeftBracket" || type === "LeftBrace") depth++;
            else if (type === "RightParen" || type === "RightBracket" || type === "RightBrace") {
              if (depth === 0) {
                expressionBody = true;
                break;
              }
              depth--;
            } else if ((type === "Dedent" || type === "EOF") && depth === 0) break;
          }
          if (expressionBody) {
            this.softExpressionIndents++;
            return { body: [], expressionBody: this.expression() };
          }
          const body = [];
          this.separators();
          while (!this.is("Dedent") && !this.is("EOF")) {
            body.push(this.statement());
            this.separators();
          }
          this.take("Dedent");
          return { body };
        };
        if (this.match("FatArrow")) {
          arrow = true;
          const body = this.match("Newline") ? newlineArrowBody() : { body: [], expressionBody: this.expression() };
          return {
            kind: "Function",
            loc: this.loc(opening),
            params,
            returnType,
            ...body,
            generics: generics.map((item) => item.name),
            genericLocs: generics.map((item) => item.loc),
            genericConstraints: generics.map((item) => item.constraint),
            genericDefaults: generics.map((item) => item.defaultType)
          };
        }
        if (generic) this.fail("Expected '=>' after generic arrow parameters");
      } catch (error) {
        if (generic || arrow) throw error;
      }
      this.pos = saved;
      this.take("LeftParen");
      const value = this.expression();
      this.take("RightParen");
      return value;
    }
    if (this.match("LeftBracket")) {
      const token = this.tokens[this.pos - 1];
      const elements = [];
      this.parenthesisSeparators();
      while (!this.is("RightBracket") && !this.is("EOF")) {
        if (this.match("Ellipsis")) {
          const spread = this.tokens[this.pos - 1];
          elements.push({ kind: "Spread", value: this.expression(), loc: this.loc(spread) });
        } else elements.push(this.expression());
        this.parenthesisSeparators();
        if (this.match("Comma")) this.parenthesisSeparators();
        else if (!this.is("RightBracket")) this.fail("Expected ',' or ']' in array");
      }
      this.take("RightBracket");
      return { kind: "Array", elements, loc: this.loc(token) };
    }
    if (this.match("LeftBrace")) {
      const token = this.tokens[this.pos - 1];
      const properties = [];
      this.objectSeparators();
      while (!this.is("RightBrace") && !this.is("EOF")) {
        if (this.match("LeftBracket")) {
          const key = this.identifier();
          this.take("Colon", "Expected ':' after index parameter");
          const indexType = this.type();
          this.take("RightBracket", "Expected ']' after index parameter type");
          this.take("Colon", "Expected ':' before indexed value type");
          const declaredType = this.type();
          properties.push({ key: key.name, keyLoc: key.loc, value: { kind: "Literal", value: null }, typeOnly: true, indexType, declaredType });
          this.objectSeparators();
          continue;
        }
        if (this.match("Ellipsis")) {
          const value2 = this.expression();
          properties.push({ key: "", keyLoc: "loc" in value2 ? value2.loc : void 0, value: value2, spread: true });
          this.objectSeparators();
          if (this.match("Comma")) this.objectSeparators();
          continue;
        }
        let readonly = false, sealed = false;
        while (this.is("Keyword") && ["readonly", "sealed"].includes(String(this.value(this.current)))) {
          const modifier = String(this.value(this.tokens[this.pos++]));
          if (modifier === "readonly") readonly = true;
          else sealed = true;
        }
        const explicitFunction = this.match("Keyword", "fun");
        const accessor = this.is("Identifier") && ["get", "set"].includes(String(this.value(this.current))) && this.tokens[this.pos + 1]?.type === "Identifier" ? String(this.value(this.tokens[this.pos++])) : void 0;
        const anonymousFunction = explicitFunction && this.is("LeftParen");
        const property = anonymousFunction ? { name: "", loc: this.loc(this.tokens[this.pos - 1]) } : this.propertyName();
        const genericParameters = explicitFunction && !anonymousFunction && this.match("Less") ? this.genericParameters() : [];
        let value;
        if (accessor) {
          const params = this.parameters();
          const returnType = this.match("Colon") ? this.type() : void 0;
          if (accessor === "get" && params.length) this.fail("A getter cannot have parameters");
          if (accessor === "set" && params.length !== 1) this.fail("A setter must have exactly one parameter");
          this.take("Equal", "Expected '=' before accessor body");
          value = { kind: "Function", params, returnType, body: this.block() };
        } else if (this.match("Colon")) value = this.expression();
        else if (this.match("LeftParen")) {
          this.pos--;
          const params = this.parameters();
          const returnType = this.match("Colon") ? this.type() : void 0;
          this.take("Equal", "Expected '=' for method body");
          const body = this.block();
          const last = body.at(-1);
          if (anonymousFunction && last?.kind === "ExpressionStatement") {
            body[body.length - 1] = { kind: "Return", value: last.expression };
          }
          value = {
            kind: "Function",
            generics: genericParameters.map((item) => item.name),
            genericLocs: genericParameters.map((item) => item.loc),
            genericConstraints: genericParameters.map((item) => item.constraint),
            genericDefaults: genericParameters.map((item) => item.defaultType),
            params,
            returnType,
            body
          };
        } else if (explicitFunction) this.fail("Expected '(' after object function name");
        else value = { kind: "Identifier", name: property.name, loc: property.loc };
        properties.push({ key: property.name, keyLoc: property.loc, value, accessor, readonly, sealed });
        this.objectSeparators();
        if (this.match("Comma")) this.objectSeparators();
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
  tryExpression(token) {
    let value, body;
    if (this.is("Newline")) body = this.block();
    else {
      value = this.expression();
      this.take("Newline", "Expected a newline after try expression");
    }
    while (this.match("Newline")) {
    }
    const indentedClauses = value !== void 0 && this.match("Indent");
    const catches = [];
    let finallyBody;
    while (this.match("Keyword", "catch")) {
      const catchToken = this.tokens[this.pos - 1];
      let binding, bindingLoc, type;
      if (this.match("LeftParen")) {
        const identifier = this.identifier();
        binding = identifier.name;
        bindingLoc = identifier.loc;
        if (this.match("Colon")) type = this.type();
        this.take("RightParen", "Expected ')' after catch binding");
      }
      catches.push({ binding, bindingLoc, type, body: this.block(), loc: this.loc(catchToken) });
      while (this.match("Newline")) {
      }
    }
    if (this.match("Keyword", "finally")) finallyBody = this.block();
    if (!catches.length) this.fail("A try expression needs at least one catch");
    if (indentedClauses) this.take("Dedent", "Expected the end of the try expression");
    return { kind: "Try", value, body, catches, finallyBody, loc: this.loc(token) };
  }
};
var unknownType = { kind: "unknown" };
function primitive(name) {
  return { kind: "primitive", name };
}
function inferredTypeNode(expression) {
  switch (expression.kind) {
    case "RegEx":
      return { kind: "NamedType", name: "RegEx" };
    case "Literal":
      return { kind: "NamedType", name: typeof expression.value === "bigint" ? "BigInt" : expression.value === null ? "null" : typeof expression.value };
    case "Template":
      return { kind: "NamedType", name: "string" };
    case "Array":
      return { kind: "ArrayType", element: expression.elements[0] ? inferredTypeNode(expression.elements[0]) : { kind: "NamedType", name: "any" } };
    case "Spread": {
      const type = inferredTypeNode(expression.value);
      return type.kind === "ArrayType" ? type.element : { kind: "NamedType", name: "any" };
    }
    case "Object":
      return { kind: "ObjectType", members: expression.properties.flatMap((property) => property.accessor === "set" ? [] : [{
        name: property.key,
        type: property.typeOnly ? property.declaredType ?? { kind: "NamedType", name: "any" } : property.accessor === "get" && property.value.kind === "Function" ? property.value.returnType ?? { kind: "NamedType", name: "any" } : inferredTypeNode(property.value),
        optional: false,
        readonly: Boolean(property.readonly),
        sealed: Boolean(property.sealed),
        constant: false,
        indexType: property.indexType
      }]) };
    case "Conditional":
      return inferredTypeNode(expression.consequent);
    case "Is":
      return { kind: "NamedType", name: "boolean" };
    default:
      return { kind: "NamedType", name: "any" };
  }
}
function inferExpressionType(expression, variables) {
  switch (expression.kind) {
    case "RegEx":
      return primitive("RegEx");
    case "Literal":
      if (typeof expression.value === "bigint") return primitive("BigInt");
      if (typeof expression.value === "number" || typeof expression.value === "string" || typeof expression.value === "boolean") return { kind: "literal", value: expression.value };
      return primitive("null");
    case "Template":
      return primitive("string");
    case "Identifier":
      return variables.get(expression.name) ?? unknownType;
    case "Array": {
      if (expression.elements.length === 0) return { kind: "array", element: unknownType };
      const elements = expression.elements.map((element) => {
        if (element.kind !== "Spread") return inferExpressionType(element, variables);
        const spread = inferExpressionType(element.value, variables);
        return spread.kind === "array" ? spread.element : unknownType;
      });
      return { kind: "array", element: commonType(elements) };
    }
    case "Spread": {
      const spread = inferExpressionType(expression.value, variables);
      return spread.kind === "array" ? spread.element : unknownType;
    }
    case "Object":
      return {
        kind: "object",
        fields: new Map(expression.properties.filter((property) => property.accessor !== "set").map((property) => [
          property.key,
          property.accessor === "get" && property.value.kind === "Function" ? property.value.returnType ? typeFromNode(property.value.returnType) : inferFunctionReturnType(property.value.body, variables) : inferExpressionType(property.value, variables)
        ]))
      };
    case "Unary":
      if (expression.operator === "-" && expression.operand.kind === "Literal" && typeof expression.operand.value === "number") return { kind: "literal", value: -expression.operand.value };
      return inferExpressionType(expression.operand, variables);
    case "Conditional":
      return commonType([inferExpressionType(expression.consequent, variables), inferExpressionType(expression.alternate, variables)]);
    case "Match": {
      const results = expression.cases.map((item) => inferFunctionReturnType(item.body, new Map(variables)));
      if (!expression.cases.some((item) => !item.pattern)) results.push(primitive("null"));
      return commonType(results);
    }
    case "Try": {
      const results = expression.catches.map((item) => inferFunctionReturnType(item.body, new Map(variables)));
      return results.length ? commonType(results) : unknownType;
    }
    case "Is":
      return primitive("boolean");
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
      if (operator === "??") return left.kind === "primitive" && left.name === "null" ? right : left;
      if (operator === "&" || operator === "|") return primitive("boolean");
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
    case "MemberAssignment":
      return unknownType;
    case "Function": {
      const scope = new Map(variables);
      for (const param of expression.params) {
        const declared = param.type ? typeFromNode(param.type) : void 0;
        const inferred = param.defaultValue ? inferExpressionType(param.defaultValue, scope) : unknownType;
        const parameterType2 = declared ?? (param.rest ? { kind: "array", element: inferred } : inferred);
        scope.set(param.name, parameterType2);
      }
      const result = expression.returnType ? typeFromNode(expression.returnType) : expression.expressionBody ? inferExpressionType(expression.expressionBody, scope) : inferFunctionReturnType(expression.body, scope);
      return { kind: "function", params: expression.params.map((param) => ({
        type: param.type ? typeFromNode(param.type) : param.defaultValue ? inferExpressionType(param.defaultValue, scope) : unknownType,
        optional: param.defaultValue !== void 0,
        rest: param.rest === true
      })), result };
    }
    case "Call": {
      const callee = inferExpressionType(expression.callee, variables);
      if (callee.kind !== "function") return unknownType;
      if (callee.params) {
        const required = callee.params.filter((param) => !param.optional && !param.rest).length;
        const rest = callee.params.some((param) => param.rest);
        const maximum = rest ? Infinity : callee.params.length;
        const hasSpread = expression.args.some((argument) => argument.kind === "Spread");
        if (!hasSpread && (expression.args.length < required || expression.args.length > maximum)) {
          throw new SyntaxError(`Expected ${required}${maximum === required ? "" : ` to ${maximum === Infinity ? "any number of" : maximum}`} arguments, received ${expression.args.length}`);
        }
        expression.args.forEach((argument, index) => {
          const parameter = callee.params.find((item, paramIndex) => item.rest ? index >= paramIndex : paramIndex === index);
          if (!parameter) return;
          const actual = inferExpressionType(argument, variables);
          if (!isAssignable(parameter.rest && parameter.type.kind === "array" ? parameter.type.element : parameter.type, actual)) {
            throw new SyntaxError(`Argument ${index + 1} has type ${describeType(actual)}; expected ${describeType(parameter.rest && parameter.type.kind === "array" ? parameter.type.element : parameter.type)}`);
          }
        });
      }
      return callee.result ?? primitive("null");
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
  if (a.kind === "literal" && b.kind === "literal") return a.value === b.value;
  if (a.kind === "array" && b.kind === "array") return sameType(a.element, b.element);
  if (a.kind === "object" && b.kind === "object") {
    return a.fields.size === b.fields.size && [...a.fields].every(([key, value]) => b.fields.has(key) && sameType(value, b.fields.get(key)));
  }
  return a.kind === "function" || a.kind === "unknown";
}
function typeFromNode(type, aliases = /* @__PURE__ */ new Map(), resolving = /* @__PURE__ */ new Set()) {
  if (type.kind === "LiteralType") return { kind: "literal", value: type.value };
  if (type.kind === "NamedType") {
    if (type.name === "any" || type.name === "unknown") return unknownType;
    const alias = aliases.get(type.name);
    if (alias && !resolving.has(type.name)) {
      const next = new Set(resolving);
      next.add(type.name);
      return typeFromNode(alias, aliases, next);
    }
    return ["string", "number", "boolean", "BigInt", "null", "void", "never", "RegEx"].includes(type.name) ? primitive(type.name) : unknownType;
  }
  if (type.kind === "ArrayType") return { kind: "array", element: typeFromNode(type.element, aliases, resolving) };
  if (type.kind === "TypeOfType") return unknownType;
  if (type.kind === "IndexedAccessType") {
    const source = typeFromNode(type.object, aliases, resolving);
    const keys = type.index.kind === "UnionType" ? type.index.types : [type.index];
    if (source.kind === "array" && keys.every((key) => key.kind === "NamedType" && key.name === "number" || key.kind === "LiteralType" && typeof key.value === "number")) return source.element;
    if (source.kind === "object") {
      const selected = keys.flatMap((key) => key.kind === "LiteralType" && (typeof key.value === "string" || typeof key.value === "number") ? [source.fields.get(String(key.value))] : []).filter((value) => Boolean(value));
      return selected.length === 1 ? selected[0] : selected.length ? { kind: "union", types: selected } : unknownType;
    }
    return unknownType;
  }
  if (type.kind === "GenericType" && (type.name === "Array" || type.name === "ReadonlyArray")) {
    return { kind: "array", element: type.args[0] ? typeFromNode(type.args[0], aliases, resolving) : unknownType };
  }
  if (type.kind === "GenericType" && ["Partial", "Required", "Readonly", "Pick", "Omit", "KeyOf", "Exclude"].includes(type.name) && type.args[0]) {
    if (type.name === "Exclude") {
      const source2 = typeFromNode(type.args[0], aliases, resolving);
      const excluded = type.args[1] ? typeFromNode(type.args[1], aliases, resolving) : unknownType;
      const parts = source2.kind === "union" ? source2.types : [source2];
      const remaining = parts.filter((part) => !isAssignable(excluded, part));
      return remaining.length === 1 ? remaining[0] : remaining.length ? { kind: "union", types: remaining } : primitive("never");
    }
    const source = typeFromNode(type.args[0], aliases, resolving);
    if (type.name === "KeyOf") {
      if (source.kind === "array") {
        const names = ["length", "indices", "has", "pick", "omit", "deepClone", "deepFreeze", "toDeepFreezed", "at", "concat", "copy", "copyWithin", "entries", "enumerate", "every", "fill", "filter", "find", "findIndex", "findLast", "findLastIndex", "flat", "flatMap", "forEach", "includes", "indexOf", "iterator", "join", "lastIndexOf", "map", "pop", "push", "reduce", "reduceRight", "reverse", "shift", "slice", "some", "sort", "splice", "toArray", "toReversed", "toSorted", "toSpliced", "toString", "unshift", "with"];
        return { kind: "union", types: [primitive("number"), ...names.map((value) => ({ kind: "literal", value }))] };
      }
      if (source.kind !== "object") return unknownType;
      return { kind: "union", types: [...source.fields.keys()].map((key) => {
        const numeric = Number(key);
        return { kind: "literal", value: key !== "" && Number.isFinite(numeric) && String(numeric) === key ? numeric : key };
      }) };
    }
    if (source.kind !== "object") return unknownType;
    let fields = [...source.fields];
    if (type.name === "Pick" || type.name === "Omit") {
      const keyValues = (node) => {
        if (!node) return [];
        if (node.kind === "LiteralType" && typeof node.value === "string") return [node.value];
        if (node.kind === "UnionType") return node.types.flatMap(keyValues);
        if (node.kind === "ArrayType") return keyValues(node.element);
        return [];
      };
      const keys = new Set(keyValues(type.args[1]));
      fields = fields.filter(([key]) => type.name === "Pick" ? keys.has(key) : !keys.has(key));
    }
    if (type.name === "Partial") return { kind: "object", fields: /* @__PURE__ */ new Map() };
    return { kind: "object", fields: new Map(fields) };
  }
  if (type.kind === "ObjectType") return { kind: "object", fields: new Map(type.members.filter((member) => !member.indexType && (!member.method || member.accessor === "get") && member.accessor !== "set" && !member.optional && member.defaultValue === void 0 && !(member.type.kind === "UnionType" && member.type.types.some((part) => part.kind === "NamedType" && part.name === "null"))).map((member) => [member.name, typeFromNode(member.type, aliases, resolving)])) };
  if (type.kind === "FunctionType") return { kind: "function" };
  if (type.kind === "UnionType") return { kind: "union", types: type.types.map((part) => typeFromNode(part, aliases, resolving)) };
  return unknownType;
}
function describeType(type) {
  if (type.kind === "primitive") return type.name;
  if (type.kind === "literal") return typeof type.value === "string" ? JSON.stringify(type.value) : String(type.value);
  if (type.kind === "union") return type.types.map(describeType).join(" | ");
  if (type.kind === "array") return `${describeType(type.element)}[]`;
  if (type.kind === "object") return `{ ${[...type.fields].map(([key, value]) => `${key}: ${describeType(value)}`).join(", ")} }`;
  return type.kind;
}
function isAssignable(expected, actual) {
  if (expected.kind === "unknown" || actual.kind === "unknown") return true;
  if (expected.kind === "function" && actual.kind === "object") return actual.fields.get("")?.kind === "function";
  if (expected.kind === "union") return actual.kind === "union" ? actual.types.every((part) => expected.types.some((option) => isAssignable(option, part))) : expected.types.some((option) => isAssignable(option, actual));
  if (actual.kind === "union") return actual.types.every((part) => isAssignable(expected, part));
  if (expected.kind === "literal") {
    if (actual.kind === "literal") return expected.value === actual.value;
    if (actual.kind === "primitive") return actual.name === typeof expected.value;
    return false;
  }
  if (actual.kind === "literal" && expected.kind === "primitive") return expected.name === typeof actual.value;
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
    if (statement.kind === "Export" && statement.declaration.kind === "TypeDeclaration") aliases.set(statement.declaration.name, statement.declaration.value);
    if (statement.kind === "Import" && statement.importedTypes) for (const [name, value] of Object.entries(statement.importedTypes)) aliases.set(name, value);
  }
  for (const statement of statements) if (statement.kind === "Import" && !statement.importedTypes) {
    try {
      const { readFileSync } = require("node:fs");
      const { resolve: resolve2, dirname: dirname2 } = require("node:path");
      if (statement.module.startsWith(".")) {
        const base = resolve2(process.cwd(), statement.module);
        const file = /\.jn$/i.test(base) ? base : `${base}.jn`;
        const imported = new Parser(Lexer(readFileSync(file, "utf8")).tokenize()).parse();
        for (const item of imported) if (item.kind === "Export" && item.declaration.kind === "TypeDeclaration") aliases.set(item.declaration.name, item.declaration.value);
      } else if (statement.module === "juno" && statement.namedImports.includes("Error")) {
        aliases.set("Error", { kind: "ObjectType", members: [
          { name: "name", type: { kind: "NamedType", name: "string" }, optional: false, readonly: false, constant: false },
          { name: "message", type: { kind: "NamedType", name: "string" }, optional: false, readonly: false, constant: false },
          { name: "stack", type: { kind: "NamedType", name: "string" }, optional: true, readonly: false, constant: false }
        ] });
      }
    } catch {
    }
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
        {
          const scope = new Map(variables);
          const functionAliases = new Map(aliases);
          for (const generic of statement.generics ?? []) functionAliases.set(generic, { kind: "NamedType", name: "any" });
          const params = statement.params.map((param) => {
            const declared = param.type ? typeFromNode(param.type, functionAliases) : void 0;
            const inferred = param.defaultValue ? inferExpressionType(param.defaultValue, scope) : unknownType;
            const type = declared ?? (param.rest ? { kind: "array", element: inferred } : inferred);
            scope.set(param.name, type);
            return { type: param.rest && type.kind !== "array" ? unknownType : type, optional: param.defaultValue !== void 0, rest: param.rest === true };
          });
          validateArithmeticTypes(statement.body, scope);
          const result = statement.returnType ? typeFromNode(statement.returnType, functionAliases) : inferFunctionReturnType(statement.body, scope);
          variables.set(statement.name, { kind: "function", params, result });
        }
        break;
      case "Import":
      case "TypeDeclaration":
        break;
    }
  }
}
function parse(source, options = {}) {
  const statements = new Parser(Lexer(source).tokenize()).parse();
  const types = /* @__PURE__ */ new Map();
  const visit = (items, seen = /* @__PURE__ */ new Set()) => {
    for (const item of items) {
      if (item.kind === "Export" && item.declaration.kind === "TypeDeclaration") types.set(item.declaration.name, item.declaration.value);
      if (item.kind === "TypeDeclaration") types.set(item.name, item.value);
      if (item.kind === "Import" && item.module.startsWith(".")) {
        try {
          const fs2 = require("node:fs");
          const path2 = require("node:path");
          const base = path2.resolve(options.filePath ? path2.dirname(options.filePath) : process.cwd(), item.module);
          const candidates = /\.jn$/i.test(base) ? [base] : [`${base}.jn`, path2.resolve(base, "index.jn")];
          const file = candidates.find((candidate) => fs2.existsSync(candidate));
          if (!file || seen.has(file)) continue;
          const nested = visitParsed(file, seen);
          for (const [name, value] of nested) if (item.namedImports.includes(name)) types.set(name, value);
        } catch {
        }
      }
      if (item.kind === "Export" && item.declaration.kind === "Import") visit([item.declaration], seen);
    }
  };
  const visitParsed = (file, seen) => {
    seen.add(file);
    const nested = /* @__PURE__ */ new Map();
    const parsed = new Parser(Lexer(require("node:fs").readFileSync(file, "utf8")).tokenize()).parse();
    for (const item of parsed) {
      if (item.kind === "Export" && item.declaration.kind === "TypeDeclaration") nested.set(item.declaration.name, item.declaration.value);
      else if (item.kind === "TypeDeclaration") nested.set(item.name, item.value);
      else if (item.kind === "Export" && item.declaration.kind === "Import" && item.declaration.importedTypes) for (const [name, value] of Object.entries(item.declaration.importedTypes)) nested.set(name, value);
    }
    return nested;
  };
  visit(statements);
  for (const item of statements) if (item.kind === "Import" && item.module === "juno" && item.namedImports.includes("Error")) types.set("Error", { kind: "ObjectType", members: [
    { name: "name", type: { kind: "NamedType", name: "string" }, optional: false, readonly: false, constant: false },
    { name: "message", type: { kind: "NamedType", name: "string" }, optional: false, readonly: false, constant: false },
    { name: "stack", type: { kind: "NamedType", name: "string" }, optional: true, readonly: false, constant: false }
  ] });
  for (const item of statements) if (item.kind === "Import") {
    item.importedTypes = Object.fromEntries([...types].filter(([name]) => item.namedImports.includes(name)));
  }
  if (options.validate !== false) {
    validateBreakStatements(statements);
    validateDeclarations(statements);
    validateArithmeticTypes(statements);
  }
  return statements;
}
function validateBreakStatements(statements, loopDepth = 0) {
  for (const statement of statements) {
    if (statement.kind === "Break") {
      if (loopDepth === 0) throw new SyntaxError(`'break' is only valid inside a loop at ${statement.loc?.line ?? 1}:${statement.loc?.column ?? 1}`);
    } else if (statement.kind === "While" || statement.kind === "ForOf") {
      validateBreakStatements(statement.body, loopDepth + 1);
    } else if (statement.kind === "If") {
      validateBreakStatements(statement.consequent, loopDepth);
      if (statement.alternate) validateBreakStatements(statement.alternate, loopDepth);
    } else if (statement.kind === "FunctionDeclaration") {
      validateBreakStatements(statement.body, 0);
    } else if (statement.kind === "ConstructorDeclaration") {
      for (const overload of statement.overloads) validateBreakStatements(overload.body, 0);
      for (const method2 of statement.methods) validateBreakStatements(method2.body, 0);
    } else if (statement.kind === "Export") {
      validateBreakStatements([statement.declaration], loopDepth);
    } else if (statement.kind === "Variable" && statement.initializer) {
      validateBreakExpression(statement.initializer, loopDepth);
    } else if (statement.kind === "Destructure" || statement.kind === "ArrayDestructure") {
      validateBreakExpression(statement.initializer, loopDepth);
    } else if (statement.kind === "ExpressionStatement") {
      validateBreakExpression(statement.expression, loopDepth);
    } else if (statement.kind === "Return" && statement.value) {
      validateBreakExpression(statement.value, loopDepth);
    }
  }
}
function validateBreakExpression(expression, loopDepth) {
  if (expression.kind === "Match") {
    validateBreakExpression(expression.value, loopDepth);
    for (const item of expression.cases) {
      if (item.guard) validateBreakExpression(item.guard, loopDepth);
      validateBreakStatements(item.body, loopDepth);
    }
  } else if (expression.kind === "Function") {
    validateBreakStatements(expression.body, 0);
    if (expression.expressionBody) validateBreakExpression(expression.expressionBody, 0);
  } else if (expression.kind === "Array") expression.elements.forEach((item) => validateBreakExpression(item, loopDepth));
  else if (expression.kind === "Object") expression.properties.forEach((item) => validateBreakExpression(item.value, loopDepth));
  else if (expression.kind === "Spread") validateBreakExpression(expression.value, loopDepth);
  else if (expression.kind === "Template") expression.parts.forEach((item) => {
    if (typeof item !== "string") validateBreakExpression(item, loopDepth);
  });
  else if (expression.kind === "Unary") validateBreakExpression(expression.operand, loopDepth);
  else if (expression.kind === "Assignment") validateBreakExpression(expression.value, loopDepth);
  else if (expression.kind === "MemberAssignment") {
    validateBreakExpression(expression.object, loopDepth);
    if (expression.index) validateBreakExpression(expression.index, loopDepth);
    validateBreakExpression(expression.value, loopDepth);
  } else if (expression.kind === "Binary") {
    validateBreakExpression(expression.left, loopDepth);
    validateBreakExpression(expression.right, loopDepth);
  } else if (expression.kind === "Conditional") {
    validateBreakExpression(expression.condition, loopDepth);
    validateBreakExpression(expression.consequent, loopDepth);
    validateBreakExpression(expression.alternate, loopDepth);
  } else if (expression.kind === "Is") validateBreakExpression(expression.value, loopDepth);
  else if (expression.kind === "Member") validateBreakExpression(expression.object, loopDepth);
  else if (expression.kind === "Index") {
    validateBreakExpression(expression.object, loopDepth);
    validateBreakExpression(expression.index, loopDepth);
  } else if (expression.kind === "Call") {
    validateBreakExpression(expression.callee, loopDepth);
    expression.args.forEach((item) => validateBreakExpression(item, loopDepth));
  }
}
function validateDeclarations(statements, initialNames = /* @__PURE__ */ new Set()) {
  const names = new Set(initialNames);
  for (const statement of statements) {
    const declarations = [];
    if (statement.kind === "Import") declarations.push(...statement.defaultImport ? [statement.defaultImport] : [], ...statement.namedImports);
    else if (statement.kind === "Variable" || statement.kind === "FunctionDeclaration" || statement.kind === "TypeDeclaration") declarations.push(statement.name);
    else if (statement.kind === "Destructure" || statement.kind === "ArrayDestructure") declarations.push(...statement.bindings.flatMap((binding) => binding.name && binding.name !== "_" ? [binding.name] : []));
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
function mathType() {
  const number = named("number");
  const unary = (name) => method(name, [{ name: "value", type: number }], number);
  const binary = (name) => method(name, [{ name: "x", type: number }, { name: "y", type: number }], number);
  return {
    kind: "ObjectType",
    members: [
      ...["E", "LN10", "LN2", "LOG10E", "LOG2E", "PI", "SQRT1_2", "SQRT2", "NaN", "Infinity"].map((name) => field(name, number, true)),
      ...["abs", "acos", "acosh", "asin", "asinh", "atan", "atanh", "cbrt", "ceil", "clz32", "cos", "cosh", "exp", "expm1", "floor", "fround", "log", "log10", "log1p", "log2", "round", "sign", "sin", "sinh", "sqrt", "tan", "tanh", "trunc"].map(unary),
      binary("atan2"),
      binary("imul"),
      binary("pow"),
      method("hypot", [{ name: "values", type: arrayOf(number), rest: true }], number),
      method("max", [{ name: "values", type: arrayOf(number), rest: true }], number),
      method("min", [{ name: "values", type: arrayOf(number), rest: true }], number),
      method("random", [], number)
    ]
  };
}
function typeUtilitiesType() {
  const any = named("any");
  return {
    kind: "ObjectType",
    members: ["Partial", "Required", "Readonly", "Pick", "Omit", "KeyOf", "Exclude"].map((name) => field(name, {
      kind: "FunctionType",
      params: name === "Pick" || name === "Omit" ? [any, arrayOf(named("string"))] : [any],
      result: any
    }))
  };
}
function promiseOf(type) {
  return type.kind === "GenericType" && type.name === "Promise" ? type : { kind: "GenericType", name: "Promise", args: [type] };
}
function awaitedType(type) {
  if (type.kind === "GenericType" && type.name === "Promise") return awaitedType(type.args[0] ?? named("unknown"));
  if (type.kind === "UnionType") return unionOf(type.types.map(awaitedType));
  return type;
}
function promiseConstructor() {
  const t = named("T");
  const u = named("U");
  const rejectedResult = { kind: "ObjectType", members: [field("ok", { kind: "LiteralType", value: false }), field("error", named("unknown"))] };
  const callback = (input, output) => ({ kind: "FunctionType", params: [input], result: output });
  return {
    kind: "constructor",
    generics: ["T"],
    inheritedType: { kind: "ObjectType", members: [
      { ...method("then", [{ name: "onFulfilled", type: callback(t, u) }], promiseOf(u)), generics: ["U"] },
      { ...method("catch", [{ name: "onRejected", type: callback(named("unknown"), u) }], promiseOf(u)), generics: ["U"] },
      method("finally", [{ name: "onFinally", type: { kind: "FunctionType", params: [], result: named("null") } }], promiseOf(t))
    ] },
    overloads: [{
      params: [{ name: "executor", type: { kind: "FunctionType", params: [
        { kind: "FunctionType", params: [{ kind: "UnionType", types: [t, promiseOf(t), rejectedResult] }], result: named("null") }
      ], result: named("null") } }],
      returnType: promiseOf(t)
    }],
    methods: [
      { name: "resolve", generics: ["U"], params: [{ name: "value", type: { kind: "UnionType", types: [u, promiseOf(u)] } }], returnType: promiseOf(u) },
      { name: "reject", generics: ["U"], genericDefaults: [named("never")], params: [{ name: "reason", type: named("unknown") }], returnType: promiseOf(u) },
      { name: "all", generics: ["U"], params: [{ name: "values", type: arrayOf({ kind: "UnionType", types: [u, promiseOf(u)] }) }], returnType: promiseOf(arrayOf(u)) },
      { name: "allSettled", generics: ["U"], params: [{ name: "values", type: arrayOf({ kind: "UnionType", types: [u, promiseOf(u)] }) }], returnType: promiseOf(arrayOf({ kind: "UnionType", types: [
        { kind: "ObjectType", members: [field("status", { kind: "LiteralType", value: "fulfilled" }), field("value", u)] },
        { kind: "ObjectType", members: [field("status", { kind: "LiteralType", value: "rejected" }), field("reason", named("unknown"))] }
      ] })) },
      { name: "any", generics: ["U"], params: [{ name: "values", type: arrayOf({ kind: "UnionType", types: [u, promiseOf(u)] }) }], returnType: promiseOf(u) },
      { name: "race", generics: ["U"], params: [{ name: "values", type: arrayOf({ kind: "UnionType", types: [u, promiseOf(u)] }) }], returnType: promiseOf(u) },
      { name: "withResolvers", generics: ["U"], params: [], returnType: { kind: "ObjectType", members: [
        field("promise", promiseOf(u)),
        field("resolve", { kind: "FunctionType", params: [{ kind: "UnionType", types: [u, promiseOf(u), rejectedResult] }], result: named("null") }),
        field("reject", { kind: "FunctionType", params: [named("unknown")], result: named("null") })
      ] } }
    ]
  };
}
function asyncModuleType() {
  const timerHandle = named("TimerHandle"), immediateHandle = named("ImmediateHandle");
  const timerMethods = ["setTimeout", "setInterval"].map((name) => {
    const symbol = asyncImportedSymbol(name);
    if (symbol?.kind !== "fun") throw new Error("Missing async timer declaration");
    return { ...method(name, symbol.params, symbol.returnType), generics: symbol.generics, genericConstraints: symbol.genericConstraints };
  });
  return { kind: "ObjectType", members: [
    field("Promise", { kind: "FunctionType", params: [named("unknown")], result: promiseOf(named("unknown")) }),
    ...timerMethods,
    field("clearTimeout", { kind: "FunctionType", params: [timerHandle], result: named("null") }),
    field("clearInterval", { kind: "FunctionType", params: [timerHandle], result: named("null") }),
    field("setImmediate", { kind: "FunctionType", params: [{ kind: "FunctionType", params: [], result: named("null") }], result: immediateHandle }),
    field("clearImmediate", { kind: "FunctionType", params: [immediateHandle], result: named("null") }),
    field("queueMicrotask", { kind: "FunctionType", params: [{ kind: "FunctionType", params: [], result: named("null") }], result: named("null") }),
    field("fetch", { kind: "FunctionType", params: [named("FetchInput"), named("FetchOptions")], result: promiseOf(named("FetchResponse")) })
  ] };
}
function moduleType(module2) {
  if (module2 === "juno:async") return asyncModuleType();
  if (module2 === "juno:types" || module2 === "types") return typeUtilitiesType();
  return { kind: "ObjectType", members: [field("console", consoleType(), true), ...module2 === "juno" ? [field("Math", mathType(), true), field("types", typeUtilitiesType(), true)] : []] };
}
function asyncImportedSymbol(name) {
  if (name === "Promise") return promiseConstructor();
  const callback = { kind: "FunctionType", params: [], result: named("null") };
  if (name === "setTimeout" || name === "setInterval") return {
    kind: "fun",
    generics: ["T", "TArgs"],
    genericConstraints: [void 0, arrayOf(named("any"))],
    params: [
      { name: "callback", type: { kind: "FunctionType", params: [], rest: named("TArgs"), result: named("T") } },
      { name: "delay", type: named("number"), ...name === "setInterval" ? { defaultValue: { kind: "Literal", value: 0 } } : {} },
      { name: "args", type: named("TArgs"), rest: true }
    ],
    returnType: named(name === "setTimeout" ? "T" : "TimerHandle")
  };
  if (name === "setImmediate") return { kind: "fun", params: [{ name: "callback", type: callback }, { name: "args", type: arrayOf(named("unknown")), rest: true }], returnType: named("ImmediateHandle") };
  if (name === "clearTimeout" || name === "clearInterval") return { kind: "fun", params: [{ name: "handle", type: named("TimerHandle") }], returnType: named("null") };
  if (name === "clearImmediate") return { kind: "fun", params: [{ name: "handle", type: named("ImmediateHandle") }], returnType: named("null") };
  if (name === "queueMicrotask") return { kind: "fun", params: [{ name: "callback", type: callback }], returnType: named("null") };
  if (name === "fetch") return { kind: "fun", params: [{ name: "input", type: named("FetchInput") }, { name: "init", type: named("FetchOptions"), defaultValue: { kind: "Literal", value: null } }], returnType: promiseOf(named("FetchResponse")) };
  const member = asyncModuleType().kind === "ObjectType" ? asyncModuleType().members.find((item) => item.name === name) : void 0;
  if (!member || member.type.kind !== "FunctionType") return void 0;
  return { kind: "fun", params: member.type.params.map((type, index) => ({ name: index === 0 ? "callback" : `arg${index}`, type })), returnType: member.type.result };
}
var cachedAsyncTypeScriptDeclarations;
function asyncTypeScriptFile() {
  const fs2 = require("node:fs");
  const path2 = require("node:path");
  return [
    path2.resolve(__dirname, "../../Modules/async.ts"),
    path2.resolve(__dirname, "../../../Modules/async.ts"),
    path2.resolve(process.cwd(), "Modules/async.ts")
  ].find((candidate) => fs2.existsSync(candidate));
}
function asyncTypeScriptSymbol(name) {
  if (name === "setTimeout" || name === "setInterval") return asyncImportedSymbol(name);
  if (!cachedAsyncTypeScriptDeclarations) {
    try {
      const fs2 = require("node:fs");
      const file = asyncTypeScriptFile();
      cachedAsyncTypeScriptDeclarations = file ? hostDeclarations(fs2.readFileSync(file, "utf8")) : /* @__PURE__ */ new Map();
    } catch {
      cachedAsyncTypeScriptDeclarations = /* @__PURE__ */ new Map();
    }
  }
  const symbol = cachedAsyncTypeScriptDeclarations.get(name);
  return symbol?.kind === "var" ? { ...symbol, mutable: false } : symbol;
}
function globals() {
  const env = /* @__PURE__ */ new Map();
  env.set("isType", {
    kind: "fun",
    params: [{ name: "value", type: named("any") }],
    returnType: named("boolean"),
    docs: "Returns true if `value` matches the type argument, for example `isType<number>(answer)`."
  });
  env.set("RegEx", {
    kind: "fun",
    params: [{ name: "pattern", type: named("string") }, { name: "flags", type: named("string"), defaultValue: { kind: "Literal", value: "" } }],
    returnType: named("RegEx"),
    docs: "Creates a regular expression without the `new` keyword."
  });
  return env;
}
function printType(type) {
  switch (type.kind) {
    case "NamedType":
      return type.name;
    case "LiteralType":
      return typeof type.value === "string" ? JSON.stringify(type.value) : String(type.value);
    case "GenericType":
      return `${type.name}<${type.args.map(printType).join(", ")}>`;
    case "IndexedAccessType":
      return `${printType(type.object)}[${printType(type.index)}]`;
    case "TypeOfType":
      return `typeof<\u2026>`;
    case "ConditionalType":
      return `${printType(type.check)} is ${printType(type.target)} ? ${printType(type.consequent)} : ${printType(type.alternate)}`;
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
        if (member.indexType) return `[${member.name}: ${printType(member.indexType)}]: ${printType(member.type)}`;
        if (member.name === "" && member.method) return `fun (${(member.params ?? []).map(printParam).join(", ")}): ${printType(member.type)}`;
        const prefix = `${member.readonly ? "readonly " : ""}${member.sealed ? "sealed " : ""}${member.constant ? "const " : ""}${member.name}${member.optional ? "?" : ""}`;
        if (member.accessor === "get") return `${member.sealed ? "sealed " : ""}get ${member.name}(): ${printType(member.type)}`;
        if (member.accessor === "set") return `${member.sealed ? "sealed " : ""}set ${member.name}(${(member.params ?? []).map(printParam).join(", ")}): void`;
        if (member.method) return `${prefix}${printGenerics(member.generics ?? [], member.genericConstraints, member.genericDefaults)}(${(member.params ?? []).map(printParam).join(", ")}): ${printType(member.type)}`;
        return `${prefix}: ${printType(member.type)}`;
      });
      return members.length ? `{ ${members.join(", ")} }` : "{}";
    }
    case "FunctionType":
      return `(${[...type.params.map(printType), ...type.rest ? [`...args: ${printType(type.rest)}`] : []].join(", ")}) -> ${printType(type.result)}`;
  }
}
function printParam(param) {
  return `${param.rest === true ? "..." : ""}${param.name}${param.type ? `: ${printType(param.type)}` : ""}${param.defaultValue !== void 0 ? " = \u2026" : ""}`;
}
function parameterType(param) {
  const type = param.type ?? named("any");
  return param.rest === true && type.kind === "ArrayType" ? type : param.rest === true && type.kind === "GenericType" && (type.name === "Array" || type.name === "ReadonlyArray") ? arrayOf(type.args[0] ?? named("any")) : type;
}
function parameterBodyType(param) {
  const type = parameterType(param);
  return type;
}
function bindInferredParameters(params, env) {
  const local = new Map(env);
  for (const param of params) {
    const type = param.type ? parameterBodyType(param) : param.defaultValue ? inferExpression(param.defaultValue, local) : parameterBodyType(param);
    local.set(param.name, { kind: "var", mutable: true, type });
  }
  return local;
}
function parameterHover(param, type = parameterType(param)) {
  return `(parameter) ${param.rest === true ? "..." : ""}${param.name}: ${printType(type)}${param.defaultValue !== void 0 ? " = \u2026" : ""}`;
}
function printFunction(name, params, returnType, generics = [], constraints = [], defaults = []) {
  const genericText = generics.length ? `<${generics.map((generic, index) => `${generic}${constraints[index] ? ` is ${printType(constraints[index])}` : ""}${defaults[index] ? ` = ${printType(defaults[index])}` : ""}`).join(", ")}>` : "";
  return `fun ${name}${genericText}(${params.map(printParam).join(", ")}): ${printType(returnType)}`;
}
function printGenerics(generics, constraints = [], defaults = []) {
  return generics.length ? `<${generics.map((generic, index) => `${generic}${constraints[index] ? ` is ${printType(constraints[index])}` : ""}${defaults[index] ? ` = ${printType(defaults[index])}` : ""}`).join(", ")}>` : "";
}
function printGenericInference(generics, args) {
  return `<${generics.map((name, index) => `${name} = ${printType(args[index] ?? named("any"))}`).join(", ")}>`;
}
function printSymbol(name, symbol) {
  switch (symbol.kind) {
    case "var":
      return { code: `${symbol.mutable ? "let" : "const"} ${name}: ${printType(symbol.type)}`, docs: symbol.docs };
    case "fun":
      return { code: printFunction(name, symbol.params, symbol.returnType, symbol.generics, symbol.genericConstraints, symbol.genericDefaults), docs: symbol.docs };
    case "type": {
      const generics = printGenerics(symbol.generics, symbol.genericConstraints, symbol.genericDefaults);
      return { code: `type ${name}${generics}`, docs: symbol.docs };
    }
    case "module":
      return { code: `import ${name} from '${symbol.module}'`, docs: symbol.docs };
    case "constructor": {
      const generics = printGenerics(symbol.generics, symbol.genericConstraints, symbol.genericDefaults);
      const resultType = symbol.generics.length ? `${name}<${symbol.generics.join(", ")}>` : name;
      const structural = symbol.inheritedType.kind === "ObjectType" && symbol.inheritedType.members.length === 0;
      const overloads = symbol.overloads.map((item) => `constructor ${name}${generics}(${item.params.map(printParam).join(", ")}): ${structural ? printType(item.returnType) : resultType}`);
      const methods = symbol.methods.map((method2) => `${name}.${method2.name}${printGenerics(method2.generics, method2.genericConstraints, method2.genericDefaults)}(${method2.params.map(printParam).join(", ")}): ${printType(method2.returnType)}`);
      return { code: [...overloads, ...methods].join("\n"), docs: symbol.docs };
    }
  }
}
function instantiate(type, generics, args, defaults = []) {
  const map = new Map(generics.map((name, index) => [name, args[index] ?? defaults[index] ?? named(name)]));
  const replace = (node) => {
    if (node.kind === "NamedType" && map.has(node.name)) return map.get(node.name);
    if (node.kind === "GenericType") return { ...node, args: node.args.map(replace) };
    if (node.kind === "UnionType" || node.kind === "IntersectionType") return { ...node, types: node.types.map(replace) };
    if (node.kind === "ArrayType") return { ...node, element: replace(node.element) };
    if (node.kind === "IndexedAccessType") return { ...node, object: replace(node.object), index: replace(node.index) };
    if (node.kind === "ConditionalType") return { ...node, check: replace(node.check), target: replace(node.target), consequent: replace(node.consequent), alternate: replace(node.alternate) };
    if (node.kind === "FunctionType") {
      const rest = node.rest && replace(node.rest);
      const tuple = rest?.kind === "ObjectType" ? rest.members.filter((member) => /^\d+$/.test(member.name)).map((member) => member.type) : rest?.kind === "GenericType" && rest.name === "Tuple" ? rest.args : void 0;
      return { ...node, params: [...node.params.map(replace), ...tuple ?? []], rest: tuple ? void 0 : rest, result: replace(node.result) };
    }
    if (node.kind === "ObjectType") return { ...node, members: node.members.map((member) => ({ ...member, type: replace(member.type), indexType: member.indexType ? replace(member.indexType) : void 0, params: member.params?.map((param) => ({ ...param, type: param.type ? replace(param.type) : void 0 })) })) };
    return node;
  };
  return replace(type);
}
function resolveType(type, env) {
  if (type.kind === "NamedType") {
    const symbol = env.get(type.name);
    if (symbol?.kind === "type") return resolveType(instantiate(symbol.value, symbol.generics, [], symbol.genericDefaults), env);
    return type;
  }
  if (type.kind === "GenericType") {
    if (type.name === "Promise") return { ...type, args: [awaitedType(type.args[0] ?? named("any"))] };
    const symbol = env.get(type.name);
    if (symbol?.kind === "type") return resolveType(instantiate(symbol.value, symbol.generics, type.args, symbol.genericDefaults), env);
    if (["Partial", "Required", "Readonly", "Pick", "Omit", "KeyOf", "Exclude"].includes(type.name) && type.args[0]) {
      if (type.name === "KeyOf" && type.args[0].kind === "NamedType" && env.get(type.args[0].name)?.kind === "type" && env.get(type.args[0].name).typeParameter) return type;
      if (type.name === "Exclude") {
        const source2 = resolveType(type.args[0], env);
        const excluded = type.args[1] ? resolveType(type.args[1], env) : named("never");
        const parts = source2.kind === "UnionType" ? source2.types : [source2];
        const remaining = parts.filter((part) => !isAssignableTo(excluded, part, env));
        return remaining.length ? unionOf(remaining) : named("never");
      }
      const source = resolveType(type.args[0], env);
      if (type.name === "KeyOf") {
        if (source.kind === "ArrayType" || source.kind === "GenericType" && (source.name === "Array" || source.name === "ReadonlyArray")) {
          const names = ["length", "indices", "has", "pick", "omit", "deepClone", "deepFreeze", "toDeepFreezed", ...Object.keys(arrayMethodDescriptions).filter((name) => name !== "from"), "iterator", "toArray", "toString"];
          return unionOf([named("number"), ...[...new Set(names)].map((value) => ({ kind: "LiteralType", value }))]);
        }
        if (source.kind === "ObjectType") return unionOf(source.members.flatMap((member) => member.indexType ? [member.indexType] : [{
          kind: "LiteralType",
          value: member.name !== "" && Number.isFinite(Number(member.name)) && String(Number(member.name)) === member.name ? Number(member.name) : member.name
        }]).map((member) => {
          if (member.kind !== "LiteralType") return member;
          return member;
        }));
        return named("any");
      }
      if (source.kind === "UnionType" || source.kind === "IntersectionType") {
        return { ...source, types: source.types.map((part) => resolveType({ ...type, args: [part, ...type.args.slice(1)] }, env)) };
      }
      if (source.kind === "ObjectType") {
        let members = source.members;
        if (type.name === "Partial") members = members.map((member) => ({ ...member, optional: true }));
        else if (type.name === "Required") members = members.map((member) => ({ ...member, optional: false }));
        else if (type.name === "Readonly") members = members.map((member) => ({ ...member, readonly: true }));
        else if (type.name === "Pick" || type.name === "Omit") {
          const keysOf = (node) => {
            if (!node) return [];
            if (node.kind === "LiteralType" && typeof node.value === "string") return [node.value];
            if (node.kind === "UnionType") return node.types.flatMap(keysOf);
            if (node.kind === "ArrayType") return keysOf(node.element);
            return [];
          };
          const keys = new Set(keysOf(type.args[1]));
          members = members.filter((member) => type.name === "Pick" ? keys.has(member.name) : !keys.has(member.name));
        }
        return { ...source, members };
      }
    }
    return type;
  }
  if (type.kind === "IntersectionType") {
    const flatten = (part) => {
      const resolved = resolveType(part, env);
      return resolved.kind === "IntersectionType" ? resolved.types.flatMap(flatten) : [resolved];
    };
    const parts = type.types.flatMap(flatten);
    if (parts.some((part) => part.kind === "UnionType")) return { kind: "IntersectionType", types: parts };
    const members = [];
    for (const part of parts) {
      if (part.kind === "ObjectType") members.push(...part.members);
    }
    return members.length ? { kind: "ObjectType", members } : { kind: "IntersectionType", types: parts };
  }
  if (type.kind === "UnionType") return { ...type, types: type.types.map((part) => resolveType(part, env)) };
  if (type.kind === "ArrayType") {
    const element = resolveType(type.element, env);
    return env.get("Array")?.kind === "constructor" ? { kind: "GenericType", name: "Array", args: [element] } : { ...type, element };
  }
  if (type.kind === "TypeOfType") {
    if (type.expression.kind === "Index" && type.expression.index.kind === "Identifier") {
      const index = env.get(type.expression.index.name);
      if (index?.kind === "type") {
        const resolvedIndex = resolveType(index.value, env);
        if (resolvedIndex.kind !== "LiteralType") return type;
      }
    }
    return resolveType(inferExpression(type.expression, env), env);
  }
  if (type.kind === "ConditionalType") {
    const check = resolveType(type.check, env);
    const target = resolveType(type.target, env);
    if (check.kind === "UnionType") return unionOf(check.types.map((part) => isAssignableTo(target, part, env) ? resolveType(type.consequent, env) : resolveType(type.alternate, env)));
    return resolveType(isAssignableTo(target, check, env) ? type.consequent : type.alternate, env);
  }
  if (type.kind === "IndexedAccessType") return indexedAccessType(type.object, type.index, env) ?? named("any");
  if (type.kind === "ObjectType") return { ...type, members: type.members.flatMap((member) => {
    const signatureEnv = new Map(env);
    for (const [name, symbol] of signatureEnv) if (symbol.kind === "type" && symbol.typeParameter) signatureEnv.delete(name);
    const indexType = member.indexType ? resolveType(member.indexType, signatureEnv) : void 0;
    const indexParts = indexType?.kind === "UnionType" ? indexType.types : indexType ? [indexType] : [];
    if (indexType && indexParts.length && indexParts.every((part) => part.kind === "LiteralType" && (typeof part.value === "string" || typeof part.value === "number"))) {
      return indexParts.map((part) => {
        const memberEnv2 = new Map(signatureEnv);
        memberEnv2.set(member.name, { kind: "type", generics: [], value: part });
        return {
          ...member,
          name: String(part.value),
          type: resolveType(member.type, memberEnv2),
          indexType: void 0,
          params: member.params?.map((param) => ({ ...param, type: param.type ? resolveType(param.type, memberEnv2) : void 0 }))
        };
      });
    }
    const memberEnv = indexType ? new Map(signatureEnv) : signatureEnv;
    if (indexType) memberEnv.set(member.name, { kind: "type", generics: [], value: indexType });
    return [{ ...member, type: resolveType(member.type, memberEnv), indexType, params: member.params?.map((param) => ({ ...param, type: param.type ? resolveType(param.type, memberEnv) : void 0 })) }];
  }) };
  if (type.kind === "FunctionType") return { ...type, params: type.params.map((param) => resolveType(param, env)), result: resolveType(type.result, env) };
  return type;
}
function isFunctionSymbol(value) {
  return Boolean(value && typeof value === "object" && "kind" in value && value.kind === "fun" && "returnType" in value);
}
function indexKeyParts(type, env) {
  const resolved = resolveType(type, env);
  return resolved.kind === "UnionType" ? resolved.types.flatMap((part) => indexKeyParts(part, env)) : [resolved];
}
function tupleShape(elements, readonly = true) {
  const element = elements.length ? unionOf(elements) : named("never");
  return { kind: "ObjectType", members: [
    ...elements.map((type, index) => ({ name: String(index), type, optional: false, readonly, constant: false })),
    { name: "index", indexType: named("number"), type: element, optional: false, readonly, constant: false },
    { name: "length", type: { kind: "LiteralType", value: elements.length }, optional: false, readonly: true, constant: false },
    { name: "toArray", type: arrayOf(element), optional: false, readonly, constant: false, method: true, params: [] }
  ] };
}
function indexedAccessType(objectType, keyType, env) {
  let object = removeNull(resolveType(objectType, env));
  if (object.kind === "GenericType" && object.name === "Tuple" && object.args[0]?.kind !== "ObjectType") object = tupleShape(object.args);
  if (object.kind === "GenericType") {
    const constructor = env.get(object.name);
    if (constructor?.kind === "constructor") object = removeNull(resolveType(instantiate(constructor.inheritedType, constructor.generics, object.args, constructor.genericDefaults), env));
  }
  const keys = indexKeyParts(keyType, env);
  const result = [];
  const addMember = (owner, key) => {
    const member = lookupMember(owner, key, env);
    if (!member) return false;
    result.push(isFunctionSymbol(member) ? functionType(member.params, member.returnType) : member);
    return true;
  };
  const collect = (owner) => {
    if (owner.kind === "UnionType") return owner.types.every(collect);
    if (owner.kind === "IntersectionType") return owner.types.some(collect);
    const arrayLike = owner.kind === "ArrayType" || owner.kind === "GenericType" && (owner.name === "Array" || owner.name === "ReadonlyArray");
    const element = owner.kind === "ArrayType" ? owner.element : owner.kind === "GenericType" ? owner.args[0] ?? named("any") : void 0;
    if (arrayLike) return keys.every((key) => {
      if (isNamedType(key, "number") || key.kind === "LiteralType" && typeof key.value === "number") {
        result.push(element ?? named("any"));
        return true;
      }
      return key.kind === "LiteralType" && typeof key.value === "string" && addMember(owner, key.value);
    });
    if (owner.kind === "ObjectType") return keys.every((key) => {
      if (key.kind === "LiteralType" && (typeof key.value === "string" || typeof key.value === "number")) {
        if (addMember(owner, String(key.value))) return true;
        const signature2 = owner.members.find((member) => member.indexType && isAssignableTo(member.indexType, key, env));
        if (signature2) {
          result.push(signature2.type);
          return true;
        }
        return false;
      }
      if (isNamedType(key, "number")) {
        const signature2 = owner.members.find((member) => member.indexType && isAssignableTo(member.indexType, key, env));
        if (signature2) {
          result.push(signature2.type);
          return true;
        }
        const numeric = owner.members.filter((member) => member.name !== "" && Number.isFinite(Number(member.name)) && String(Number(member.name)) === member.name);
        if (!numeric.length) return false;
        result.push(...numeric.map((member) => member.type));
        return true;
      }
      const signature = owner.members.find((member) => member.indexType && isAssignableTo(member.indexType, key, env));
      if (signature) {
        result.push(signature.type);
        return true;
      }
      return false;
    });
    return false;
  };
  return collect(object) && result.length ? unionOf(result) : void 0;
}
function arrayDestructureRestType(sourceType, start, env) {
  if (sourceType.kind === "GenericType" && sourceType.name === "Tuple" && sourceType.args[0]?.kind !== "ObjectType") {
    return tupleShape(sourceType.args.slice(start), false);
  }
  if (sourceType.kind === "GenericType" && sourceType.name === "Tuple" && sourceType.args[0]?.kind === "ObjectType") {
    const tuple = sourceType.args[0];
    const entries = tuple.members.filter((member) => member.name !== "" && Number.isInteger(Number(member.name)) && Number(member.name) >= start).sort((left, right) => Number(left.name) - Number(right.name));
    const element2 = entries.length ? unionOf(entries.map((member) => member.type)) : named("never");
    return { kind: "ObjectType", members: [
      ...entries.map((member, index) => ({ ...member, name: String(index), readonly: false })),
      { name: "index", indexType: named("number"), type: element2, optional: false, readonly: false, constant: false },
      { name: "length", type: { kind: "LiteralType", value: entries.length }, optional: false, readonly: true, constant: false },
      { name: "toArray", type: arrayOf(element2), optional: false, readonly: false, constant: false, method: true, params: [] }
    ] };
  }
  const element = iterableElementType(sourceType, env);
  return arrayOf(element);
}
function callableType(type, env) {
  const resolved = resolveType(type, env);
  if (resolved.kind === "FunctionType") return resolved;
  if (resolved.kind === "ObjectType") {
    const call = resolved.members.find((member) => member.name === "" && member.method);
    if (call) return { kind: "FunctionType", params: (call.params ?? []).map(parameterType), result: call.type };
  }
  if (resolved.kind === "IntersectionType") {
    for (const part of resolved.types) {
      const call = callableType(part, env);
      if (call) return call;
    }
  }
  return void 0;
}
function deepReadonlyType(type, env) {
  const resolved = resolveType(type, env);
  if (resolved.kind === "ArrayType") return { kind: "GenericType", name: "ReadonlyArray", args: [deepReadonlyType(resolved.element, env)] };
  if (resolved.kind === "GenericType" && (resolved.name === "Array" || resolved.name === "ReadonlyArray")) {
    return { kind: "GenericType", name: "ReadonlyArray", args: [deepReadonlyType(resolved.args[0] ?? named("any"), env)] };
  }
  if (resolved.kind === "ObjectType") return {
    ...resolved,
    members: resolved.members.map((member) => member.method ? member : { ...member, readonly: true, type: deepReadonlyType(member.type, env) })
  };
  if (resolved.kind === "UnionType" || resolved.kind === "IntersectionType") {
    return { ...resolved, types: resolved.types.map((part) => deepReadonlyType(part, env)) };
  }
  return resolved;
}
function lookupMember(type, name, env) {
  if (type.kind === "GenericType" && type.name === "Tuple" && type.args[0]?.kind !== "ObjectType") return lookupMember(tupleShape(type.args), name, env);
  if (type.kind === "NamedType" && type.name === "Error") {
    if (name === "type" || name === "message") return named("string");
    if (name === "stackTrace") return unionOf([arrayOf(named("string")), named("null")]);
  }
  if (name === "asReadonly" || name === "asMutable") {
    const rawElement = type.kind === "ArrayType" ? type.element : type.kind === "GenericType" && (type.name === "Array" || type.name === "ReadonlyArray") ? type.args[0] ?? named("any") : void 0;
    if (rawElement) return {
      kind: "fun",
      params: [],
      returnType: { kind: "GenericType", name: name === "asReadonly" ? "ReadonlyArray" : "Array", args: [rawElement] },
      ownerType: type
    };
  }
  if (type.kind === "NamedType") {
    const constructor = env.get(type.name);
    if (constructor?.kind === "constructor") {
      for (const overload of constructor.overloads) {
        if (overload.returnType.kind === "NamedType" && overload.returnType.name === type.name) continue;
        const member = lookupMember(overload.returnType, name, env);
        if (member) return member;
      }
      return lookupMember(constructor.inheritedType, name, env);
    }
  }
  if (type.kind === "GenericType") {
    const constructor = env.get(type.name);
    if (constructor?.kind === "constructor") {
      for (const overload of constructor.overloads) {
        const result = instantiate(overload.returnType, constructor.generics, type.args);
        if (result.kind === "GenericType" && result.name === type.name) continue;
        const member = lookupMember(result, name, env);
        if (member) return member;
      }
      const inherited = instantiate(constructor.inheritedType, constructor.generics, type.args);
      if (!(inherited.kind === "GenericType" && inherited.name === type.name)) {
        const member = lookupMember(inherited, name, env);
        if (member) return member;
      }
    }
  }
  const resolved = resolveType(type, env);
  if (resolved.kind === "GenericType" && resolved.name === "ReadonlyArray" && ["copyWithin", "fill", "pop", "push", "reverse", "shift", "sort", "splice", "unshift"].includes(name)) return void 0;
  if (name === "isType") return { kind: "fun", params: [], returnType: named("boolean") };
  if (name === "deepClone" && (resolved.kind === "ObjectType" || resolved.kind === "ArrayType" || resolved.kind === "GenericType" && (resolved.name === "Array" || resolved.name === "ReadonlyArray"))) {
    return { kind: "fun", params: [], returnType: resolved, ownerType: resolved };
  }
  if ((name === "deepFreeze" || name === "toDeepFreezed") && (resolved.kind === "ObjectType" || resolved.kind === "ArrayType" || resolved.kind === "GenericType" && (resolved.name === "Array" || resolved.name === "ReadonlyArray"))) {
    return { kind: "fun", params: [], returnType: deepReadonlyType(resolved, env), ownerType: resolved };
  }
  if (name === "asReadonly" || name === "asMutable") {
    let result = resolved;
    if (resolved.kind === "ArrayType") result = name === "asReadonly" ? { kind: "GenericType", name: "ReadonlyArray", args: [resolved.element] } : resolved;
    else if (resolved.kind === "GenericType" && (resolved.name === "Array" || resolved.name === "ReadonlyArray")) {
      result = { kind: "GenericType", name: name === "asReadonly" ? "ReadonlyArray" : "Array", args: resolved.args };
    } else if (resolved.kind === "ObjectType") {
      result = { ...resolved, members: resolved.members.map((member) => ({ ...member, readonly: name === "asReadonly" })) };
    }
    return { kind: "fun", params: [], returnType: result, ownerType: resolved };
  }
  if ((name === "pick" || name === "omit") && !(resolved.kind === "ObjectType" && resolved.members.some((member) => member.name === name)) && (resolved.kind === "ObjectType" || resolved.kind === "ArrayType" || resolved.kind === "GenericType" && (resolved.name === "Array" || resolved.name === "ReadonlyArray"))) {
    const keys = resolveType({ kind: "GenericType", name: "KeyOf", args: [resolved] }, env);
    const selectedKeys = name === "pick" ? named("T") : { kind: "GenericType", name: "Exclude", args: [{ kind: "GenericType", name: "KeyOf", args: [resolved] }, named("T")] };
    const result = {
      kind: "ObjectType",
      members: [{
        name: "key",
        indexType: selectedKeys,
        type: { kind: "IndexedAccessType", object: resolved, index: named("key") },
        optional: false,
        readonly: false,
        constant: false
      }]
    };
    return {
      kind: "fun",
      generics: ["T"],
      genericConstraints: [keys],
      params: [{ name: "keys", type: arrayOf(named("T")), rest: true }],
      returnType: result,
      ownerType: resolved
    };
  }
  if (isNamedType(resolved, "string")) {
    const fn = (params, returnType) => ({ kind: "fun", params, returnType });
    const p = (paramName, paramType, optional = false) => ({ name: paramName, type: paramType, ...optional ? { defaultValue: { kind: "Literal", value: null } } : {} });
    const string = named("string"), number = named("number"), boolean = named("boolean");
    const matcher = unionOf([string, named("RegEx")]);
    switch (name) {
      case "length":
        return number;
      case "indices":
        return named("Range");
      case "at":
      case "charAt":
        return fn([p("index", number)], string);
      case "charCodeAt":
      case "codePointAt":
        return fn([p("index", number)], number);
      case "concat":
        return fn([{ name: "strings", type: arrayOf(string), rest: true }], string);
      case "endsWith":
      case "startsWith":
        return fn([p("search", string), p("position", number, true)], boolean);
      case "includes":
        return fn([p("search", matcher), p("position", number, true)], boolean);
      case "test":
        return fn([p("pattern", matcher)], boolean);
      case "exec":
        return fn([p("pattern", matcher)], unionOf([arrayOf(string), named("null")]));
      case "find":
      case "findLast":
        return fn([p("search", matcher)], unionOf([string, named("null")]));
      case "findIndex":
      case "findLastIndex":
        return fn([p("search", matcher)], number);
      case "join":
        return fn([p("separator", string, true)], string);
      case "indexOf":
      case "lastIndexOf":
        return fn([p("search", string), p("position", number, true)], number);
      case "localeCompare":
        return fn([p("other", string)], number);
      case "match":
      case "matchAll":
        return fn([p("regexp", matcher)], unionOf([arrayOf(string), named("null")]));
      case "normalize":
        return fn([p("form", string, true)], string);
      case "padEnd":
      case "padStart":
        return fn([p("length", number), p("fill", string, true)], string);
      case "repeat":
        return fn([p("count", number)], string);
      case "replace":
      case "replaceAll":
        return fn([p("search", matcher), p("replacement", string)], string);
      case "search":
        return fn([p("regexp", matcher)], number);
      case "slice":
      case "substring":
      case "substr":
        return fn([p("start", number, true), p("end", number, true)], string);
      case "split":
        return fn([p("separator", matcher, true), p("limit", number, true)], arrayOf(string));
      case "toLocaleLowerCase":
      case "toLocaleUpperCase":
      case "toLowerCase":
      case "toUpperCase":
      case "toString":
      case "trim":
      case "trimEnd":
      case "trimStart":
      case "valueOf":
        return fn([], string);
      case "toArray":
        return fn([], arrayOf(string));
      case "iterator":
        return fn([], { kind: "FunctionType", params: [], result: unionOf([{ kind: "ObjectType", members: [field("value", string)] }, named("null")]) });
    }
  }
  if (isNamedType(resolved, "number") && name === "valueOf") {
    return { kind: "fun", params: [], returnType: named("number") };
  }
  if (isNamedType(resolved, "RegEx")) {
    const fn = (params, returnType) => ({ kind: "fun", params, returnType });
    const string = named("string"), boolean = named("boolean"), number = named("number"), any = named("any");
    const input = unionOf([string, named("RegEx")]);
    switch (name) {
      case "source":
      case "flags":
        return string;
      case "global":
      case "ignoreCase":
      case "multiline":
      case "dotAll":
      case "sticky":
      case "unicode":
      case "hasIndices":
      case "unicodeSets":
        return boolean;
      case "lastIndex":
        return number;
      case "test":
        return fn([{ name: "value", type: input }], boolean);
      case "exec":
        return fn([{ name: "value", type: input }], unionOf([arrayOf(string), named("null")]));
      case "compile":
        return fn([{ name: "pattern", type: input }, { name: "flags", type: string, defaultValue: { kind: "Literal", value: "" } }], named("RegEx"));
    }
  }
  if (resolved.kind === "IntersectionType") {
    for (const part of resolved.types) {
      const member = lookupMember(part, name, env);
      if (member) return member;
    }
  }
  if (resolved.kind === "UnionType") {
    const members = resolved.types.map((part) => lookupMember(part, name, env));
    if (members.length && members.every(Boolean)) return members[0];
  }
  if (resolved.kind === "ObjectType") {
    const member = resolved.members.find((item) => item.name === name && item.accessor === "get") ?? resolved.members.find((item) => item.name === name);
    if (member) {
      if (member.accessor === "get") return member.type;
      if (member.accessor === "set") return member.type;
      if (member.method) return { kind: "fun", generics: member.generics, genericConstraints: member.genericConstraints, genericDefaults: member.genericDefaults, params: member.params ?? [], returnType: member.type, body: member.body, ownerType: resolved };
      return member.type;
    }
    const call = resolved.members.find((item) => item.name === "" && item.method);
    if (call) {
      const params = call.params ?? [];
      const signature = { kind: "FunctionType", params: params.map(parameterType), result: call.type };
      if (name === "call") return { kind: "fun", params: [{ name: "thisArg", type: named("any") }, ...params], returnType: call.type };
      if (name === "apply") return { kind: "fun", params: [{ name: "thisArg", type: named("any") }, { name: "args", type: arrayOf(named("any")) }], returnType: call.type };
      if (name === "bind") return { kind: "fun", params: [{ name: "thisArg", type: named("any") }, { name: "args", type: arrayOf(named("any")), rest: true }], returnType: signature };
    }
    if (name === "has") return { kind: "fun", params: [{ name: "key", type: named("string") }], returnType: named("boolean") };
  }
  if (resolved.kind === "FunctionType" && name === "call") {
    return { kind: "fun", params: [{ name: "thisArg", type: named("any") }, { name: "args", type: arrayOf(named("any")), rest: true }], returnType: resolved.result };
  }
  if (name === "has" && (resolved.kind === "ArrayType" || resolved.kind === "GenericType" && (resolved.name === "Array" || resolved.name === "ReadonlyArray"))) {
    return { kind: "fun", params: [{ name: "key", type: named("string") }], returnType: named("boolean") };
  }
  const element = resolved.kind === "ArrayType" ? resolved.element : resolved.kind === "GenericType" && (resolved.name === "Array" || resolved.name === "ReadonlyArray") ? resolved.args[0] ?? named("any") : void 0;
  if (element) {
    const fn = (params, returnType) => ({ kind: "fun", params, returnType });
    const p = (paramName, paramType, optional = false) => ({ name: paramName, type: paramType, ...optional ? { defaultValue: { kind: "Literal", value: null } } : {} });
    const callback = (params, result) => ({ kind: "FunctionType", params, result });
    const number = named("number"), boolean = named("boolean"), string = named("string"), any = named("any");
    switch (name) {
      case "length":
        return number;
      case "indices":
        return named("Range");
      case "copy":
      case "toArray":
        return fn([], arrayOf(element));
      case "at":
        return fn([p("index", number)], unionOf([element, named("null")]));
      case "concat":
        return fn([{ name: "items", type: arrayOf(element), rest: true }], arrayOf(element));
      case "every":
      case "some":
        return fn([p("callback", callback([element], boolean))], boolean);
      case "filter":
        return fn([p("callback", callback([element], boolean))], arrayOf(element));
      case "find":
      case "findLast":
        return fn([p("callback", callback([element], boolean))], unionOf([element, named("null")]));
      case "findIndex":
      case "findLastIndex":
      case "indexOf":
      case "lastIndexOf":
        return fn([p(name.startsWith("find") ? "callback" : "value", name.startsWith("find") ? callback([element], boolean) : element)], number);
      case "flat":
        return fn([], arrayOf(any));
      case "flatMap":
        return fn([p("callback", callback([element], arrayOf(any)))], arrayOf(any));
      case "forEach":
        return fn([p("callback", callback([element], any))], named("void"));
      case "includes":
        return fn([p("value", element)], boolean);
      case "join":
        return fn([p("separator", string, true)], string);
      case "map":
        return fn([p("callback", callback([element], any))], arrayOf(any));
      case "pop":
      case "shift":
        return fn([], unionOf([element, named("null")]));
      case "push":
      case "unshift":
        return fn([{ name: "items", type: arrayOf(element), rest: true }], number);
      case "reduce":
      case "reduceRight":
        return fn([p("callback", callback([any, element], any)), p("initial", any)], any);
      case "slice":
        return fn([p("start", number, true), p("end", number, true)], arrayOf(element));
      case "sort":
        return fn([p("compare", callback([element, element], number), true)], arrayOf(element));
      case "toLocaleString":
      case "toString":
        return fn([], string);
      case "toReversed":
      case "toSorted":
        return fn([], arrayOf(element));
      case "toSpliced":
        return fn([p("start", number), p("deleteCount", number), p("items", arrayOf(element), true)], arrayOf(element));
      case "with":
        return fn([p("index", number), p("value", element)], arrayOf(element));
    }
  }
  if (name === "toString" && !(resolved.kind === "NamedType" && resolved.name === "null") && !(resolved.kind === "LiteralType" && resolved.value === null)) {
    return { kind: "fun", params: [], returnType: named("string") };
  }
  if (name === "as" && !(resolved.kind === "NamedType" && resolved.name === "null") && !(resolved.kind === "LiteralType" && resolved.value === null)) {
    return { kind: "fun", params: [], returnType: named("any") };
  }
  return void 0;
}
function lookupAccessor(type, name, accessor, env) {
  const resolved = resolveType(type, env);
  if (resolved.kind === "ObjectType") return resolved.members.find((member) => !member.indexType && member.name === name && member.accessor === accessor);
  if (resolved.kind === "IntersectionType" || resolved.kind === "UnionType") {
    for (const part of resolved.types) {
      const member = lookupAccessor(part, name, accessor, env);
      if (member) return member;
    }
  }
  return void 0;
}
var arrayMethodDescriptions = {
  at: "\u0412\u043E\u0437\u0432\u0440\u0430\u0449\u0430\u0435\u0442 \u044D\u043B\u0435\u043C\u0435\u043D\u0442 \u043F\u043E \u0438\u043D\u0434\u0435\u043A\u0441\u0443. \u041E\u0442\u0440\u0438\u0446\u0430\u0442\u0435\u043B\u044C\u043D\u044B\u0439 \u0438\u043D\u0434\u0435\u043A\u0441 \u043E\u0442\u0441\u0447\u0438\u0442\u044B\u0432\u0430\u0435\u0442\u0441\u044F \u043E\u0442 \u043A\u043E\u043D\u0446\u0430 \u043C\u0430\u0441\u0441\u0438\u0432\u0430.",
  concat: "\u0421\u043E\u0437\u0434\u0430\u0451\u0442 \u043D\u043E\u0432\u044B\u0439 \u043C\u0430\u0441\u0441\u0438\u0432, \u043E\u0431\u044A\u0435\u0434\u0438\u043D\u044F\u044F \u0442\u0435\u043A\u0443\u0449\u0438\u0439 \u043C\u0430\u0441\u0441\u0438\u0432 \u0441 \u043F\u0435\u0440\u0435\u0434\u0430\u043D\u043D\u044B\u043C\u0438 \u044D\u043B\u0435\u043C\u0435\u043D\u0442\u0430\u043C\u0438.",
  copy: "\u0421\u043E\u0437\u0434\u0430\u0451\u0442 \u043D\u0435\u0437\u0430\u0432\u0438\u0441\u0438\u043C\u0443\u044E \u043F\u043E\u0432\u0435\u0440\u0445\u043D\u043E\u0441\u0442\u043D\u0443\u044E \u043A\u043E\u043F\u0438\u044E \u043C\u0430\u0441\u0441\u0438\u0432\u0430.",
  copyWithin: "\u041A\u043E\u043F\u0438\u0440\u0443\u0435\u0442 \u0447\u0430\u0441\u0442\u044C \u043C\u0430\u0441\u0441\u0438\u0432\u0430 \u0432 \u0434\u0440\u0443\u0433\u0443\u044E \u043F\u043E\u0437\u0438\u0446\u0438\u044E \u0432\u043D\u0443\u0442\u0440\u0438 \u044D\u0442\u043E\u0433\u043E \u0436\u0435 \u043C\u0430\u0441\u0441\u0438\u0432\u0430.",
  entries: "\u0412\u043E\u0437\u0432\u0440\u0430\u0449\u0430\u0435\u0442 \u043F\u0430\u0440\u044B \u0438\u043D\u0434\u0435\u043A\u0441\u0430 \u0438 \u0437\u043D\u0430\u0447\u0435\u043D\u0438\u044F \u043C\u0430\u0441\u0441\u0438\u0432\u0430.",
  enumerate: "\u0412\u043E\u0437\u0432\u0440\u0430\u0449\u0430\u0435\u0442 \u043F\u0430\u0440\u044B `[index, value]` \u0434\u043B\u044F \u0432\u0441\u0435\u0445 \u044D\u043B\u0435\u043C\u0435\u043D\u0442\u043E\u0432 \u043C\u0430\u0441\u0441\u0438\u0432\u0430.",
  every: "\u041F\u0440\u043E\u0432\u0435\u0440\u044F\u0435\u0442, \u0443\u0434\u043E\u0432\u043B\u0435\u0442\u0432\u043E\u0440\u044F\u044E\u0442 \u043B\u0438 \u0432\u0441\u0435 \u044D\u043B\u0435\u043C\u0435\u043D\u0442\u044B \u0443\u0441\u043B\u043E\u0432\u0438\u044E callback.",
  fill: "\u0417\u0430\u043F\u043E\u043B\u043D\u044F\u0435\u0442 \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u044B\u0439 \u0434\u0438\u0430\u043F\u0430\u0437\u043E\u043D \u043C\u0430\u0441\u0441\u0438\u0432\u0430 \u0443\u043A\u0430\u0437\u0430\u043D\u043D\u044B\u043C \u0437\u043D\u0430\u0447\u0435\u043D\u0438\u0435\u043C.",
  filter: "\u0421\u043E\u0437\u0434\u0430\u0451\u0442 \u043C\u0430\u0441\u0441\u0438\u0432 \u044D\u043B\u0435\u043C\u0435\u043D\u0442\u043E\u0432, \u0434\u043B\u044F \u043A\u043E\u0442\u043E\u0440\u044B\u0445 callback \u0432\u0435\u0440\u043D\u0443\u043B true.",
  find: "\u0412\u043E\u0437\u0432\u0440\u0430\u0449\u0430\u0435\u0442 \u043F\u0435\u0440\u0432\u044B\u0439 \u044D\u043B\u0435\u043C\u0435\u043D\u0442, \u0443\u0434\u043E\u0432\u043B\u0435\u0442\u0432\u043E\u0440\u044F\u044E\u0449\u0438\u0439 \u0443\u0441\u043B\u043E\u0432\u0438\u044E, \u0438\u043B\u0438 null.",
  findIndex: "\u0412\u043E\u0437\u0432\u0440\u0430\u0449\u0430\u0435\u0442 \u0438\u043D\u0434\u0435\u043A\u0441 \u043F\u0435\u0440\u0432\u043E\u0433\u043E \u043F\u043E\u0434\u0445\u043E\u0434\u044F\u0449\u0435\u0433\u043E \u044D\u043B\u0435\u043C\u0435\u043D\u0442\u0430 \u0438\u043B\u0438 -1.",
  findLast: "\u0412\u043E\u0437\u0432\u0440\u0430\u0449\u0430\u0435\u0442 \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0439 \u044D\u043B\u0435\u043C\u0435\u043D\u0442, \u0443\u0434\u043E\u0432\u043B\u0435\u0442\u0432\u043E\u0440\u044F\u044E\u0449\u0438\u0439 \u0443\u0441\u043B\u043E\u0432\u0438\u044E, \u0438\u043B\u0438 null.",
  findLastIndex: "\u0412\u043E\u0437\u0432\u0440\u0430\u0449\u0430\u0435\u0442 \u0438\u043D\u0434\u0435\u043A\u0441 \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u0435\u0433\u043E \u043F\u043E\u0434\u0445\u043E\u0434\u044F\u0449\u0435\u0433\u043E \u044D\u043B\u0435\u043C\u0435\u043D\u0442\u0430 \u0438\u043B\u0438 -1.",
  flat: "\u0421\u043E\u0437\u0434\u0430\u0451\u0442 \u043C\u0430\u0441\u0441\u0438\u0432 \u0441 \u0443\u043C\u0435\u043D\u044C\u0448\u0435\u043D\u043D\u043E\u0439 \u043D\u0430 \u043E\u0434\u0438\u043D \u0443\u0440\u043E\u0432\u0435\u043D\u044C \u0432\u043B\u043E\u0436\u0435\u043D\u043D\u043E\u0441\u0442\u044C\u044E.",
  flatMap: "\u041F\u0440\u0438\u043C\u0435\u043D\u044F\u0435\u0442 callback \u0438 \u043E\u0431\u044A\u0435\u0434\u0438\u043D\u044F\u0435\u0442 \u043F\u043E\u043B\u0443\u0447\u0435\u043D\u043D\u044B\u0435 \u043C\u0430\u0441\u0441\u0438\u0432\u044B \u043D\u0430 \u043E\u0434\u0438\u043D \u0443\u0440\u043E\u0432\u0435\u043D\u044C.",
  forEach: "\u0412\u044B\u0437\u044B\u0432\u0430\u0435\u0442 callback \u0434\u043B\u044F \u043A\u0430\u0436\u0434\u043E\u0433\u043E \u044D\u043B\u0435\u043C\u0435\u043D\u0442\u0430 \u043C\u0430\u0441\u0441\u0438\u0432\u0430.",
  from: "\u0421\u043E\u0437\u0434\u0430\u0451\u0442 \u043D\u043E\u0432\u044B\u0439 Array \u0438\u0437 \u044D\u043B\u0435\u043C\u0435\u043D\u0442\u043E\u0432 \u0438\u0441\u0442\u043E\u0447\u043D\u0438\u043A\u0430 \u0438 \u043F\u0440\u0438 \u043D\u0435\u043E\u0431\u0445\u043E\u0434\u0438\u043C\u043E\u0441\u0442\u0438 \u043F\u0440\u0435\u043E\u0431\u0440\u0430\u0437\u0443\u0435\u0442 \u0438\u0445 callback-\u0444\u0443\u043D\u043A\u0446\u0438\u0435\u0439.",
  includes: "\u041F\u0440\u043E\u0432\u0435\u0440\u044F\u0435\u0442 \u043D\u0430\u043B\u0438\u0447\u0438\u0435 \u0437\u043D\u0430\u0447\u0435\u043D\u0438\u044F \u0432 \u043C\u0430\u0441\u0441\u0438\u0432\u0435.",
  indexOf: "\u0412\u043E\u0437\u0432\u0440\u0430\u0449\u0430\u0435\u0442 \u043F\u0435\u0440\u0432\u044B\u0439 \u0438\u043D\u0434\u0435\u043A\u0441 \u0437\u043D\u0430\u0447\u0435\u043D\u0438\u044F \u0438\u043B\u0438 -1.",
  join: "\u041E\u0431\u044A\u0435\u0434\u0438\u043D\u044F\u0435\u0442 \u044D\u043B\u0435\u043C\u0435\u043D\u0442\u044B \u043C\u0430\u0441\u0441\u0438\u0432\u0430 \u0432 \u0441\u0442\u0440\u043E\u043A\u0443 \u0447\u0435\u0440\u0435\u0437 \u0440\u0430\u0437\u0434\u0435\u043B\u0438\u0442\u0435\u043B\u044C.",
  lastIndexOf: "\u0412\u043E\u0437\u0432\u0440\u0430\u0449\u0430\u0435\u0442 \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0439 \u0438\u043D\u0434\u0435\u043A\u0441 \u0437\u043D\u0430\u0447\u0435\u043D\u0438\u044F \u0438\u043B\u0438 -1.",
  map: "\u0421\u043E\u0437\u0434\u0430\u0451\u0442 \u043C\u0430\u0441\u0441\u0438\u0432 \u0440\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442\u043E\u0432 \u0432\u044B\u0437\u043E\u0432\u0430 callback \u0434\u043B\u044F \u043A\u0430\u0436\u0434\u043E\u0433\u043E \u044D\u043B\u0435\u043C\u0435\u043D\u0442\u0430.",
  pop: "\u0423\u0434\u0430\u043B\u044F\u0435\u0442 \u0438 \u0432\u043E\u0437\u0432\u0440\u0430\u0449\u0430\u0435\u0442 \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u0438\u0439 \u044D\u043B\u0435\u043C\u0435\u043D\u0442 \u0438\u043B\u0438 null \u0434\u043B\u044F \u043F\u0443\u0441\u0442\u043E\u0433\u043E \u043C\u0430\u0441\u0441\u0438\u0432\u0430.",
  push: "\u0414\u043E\u0431\u0430\u0432\u043B\u044F\u0435\u0442 \u044D\u043B\u0435\u043C\u0435\u043D\u0442\u044B \u0432 \u043A\u043E\u043D\u0435\u0446 \u043C\u0430\u0441\u0441\u0438\u0432\u0430 \u0438 \u0432\u043E\u0437\u0432\u0440\u0430\u0449\u0430\u0435\u0442 \u043D\u043E\u0432\u0443\u044E \u0434\u043B\u0438\u043D\u0443.",
  reduce: "\u0421\u0432\u043E\u0440\u0430\u0447\u0438\u0432\u0430\u0435\u0442 \u043C\u0430\u0441\u0441\u0438\u0432 \u0441\u043B\u0435\u0432\u0430 \u043D\u0430\u043F\u0440\u0430\u0432\u043E \u0432 \u043E\u0434\u043D\u043E \u0437\u043D\u0430\u0447\u0435\u043D\u0438\u0435.",
  reduceRight: "\u0421\u0432\u043E\u0440\u0430\u0447\u0438\u0432\u0430\u0435\u0442 \u043C\u0430\u0441\u0441\u0438\u0432 \u0441\u043F\u0440\u0430\u0432\u0430 \u043D\u0430\u043B\u0435\u0432\u043E \u0432 \u043E\u0434\u043D\u043E \u0437\u043D\u0430\u0447\u0435\u043D\u0438\u0435.",
  reverse: "\u0420\u0430\u0437\u0432\u043E\u0440\u0430\u0447\u0438\u0432\u0430\u0435\u0442 \u043C\u0430\u0441\u0441\u0438\u0432 \u043D\u0430 \u043C\u0435\u0441\u0442\u0435 \u0438 \u0432\u043E\u0437\u0432\u0440\u0430\u0449\u0430\u0435\u0442 \u0435\u0433\u043E.",
  shift: "\u0423\u0434\u0430\u043B\u044F\u0435\u0442 \u0438 \u0432\u043E\u0437\u0432\u0440\u0430\u0449\u0430\u0435\u0442 \u043F\u0435\u0440\u0432\u044B\u0439 \u044D\u043B\u0435\u043C\u0435\u043D\u0442 \u0438\u043B\u0438 null \u0434\u043B\u044F \u043F\u0443\u0441\u0442\u043E\u0433\u043E \u043C\u0430\u0441\u0441\u0438\u0432\u0430.",
  slice: "\u0421\u043E\u0437\u0434\u0430\u0451\u0442 \u043A\u043E\u043F\u0438\u044E \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u043E\u0433\u043E \u0434\u0438\u0430\u043F\u0430\u0437\u043E\u043D\u0430 \u043C\u0430\u0441\u0441\u0438\u0432\u0430.",
  some: "\u041F\u0440\u043E\u0432\u0435\u0440\u044F\u0435\u0442, \u0443\u0434\u043E\u0432\u043B\u0435\u0442\u0432\u043E\u0440\u044F\u0435\u0442 \u043B\u0438 \u0445\u043E\u0442\u044F \u0431\u044B \u043E\u0434\u0438\u043D \u044D\u043B\u0435\u043C\u0435\u043D\u0442 \u0443\u0441\u043B\u043E\u0432\u0438\u044E callback.",
  sort: "\u0421\u043E\u0440\u0442\u0438\u0440\u0443\u0435\u0442 \u043C\u0430\u0441\u0441\u0438\u0432 \u043D\u0430 \u043C\u0435\u0441\u0442\u0435. Callback \u043F\u043E\u043B\u0443\u0447\u0430\u0435\u0442 \u0434\u0432\u0430 \u044D\u043B\u0435\u043C\u0435\u043D\u0442\u0430 \u0442\u0438\u043F\u0430 \u043C\u0430\u0441\u0441\u0438\u0432\u0430.",
  splice: "\u0423\u0434\u0430\u043B\u044F\u0435\u0442 \u0438 \u0434\u043E\u0431\u0430\u0432\u043B\u044F\u0435\u0442 \u044D\u043B\u0435\u043C\u0435\u043D\u0442\u044B \u043D\u0430 \u043C\u0435\u0441\u0442\u0435, \u0432\u043E\u0437\u0432\u0440\u0430\u0449\u0430\u044F \u0443\u0434\u0430\u043B\u0451\u043D\u043D\u044B\u0435 \u044D\u043B\u0435\u043C\u0435\u043D\u0442\u044B.",
  toArray: "\u0412\u043E\u0437\u0432\u0440\u0430\u0449\u0430\u0435\u0442 \u043E\u0431\u044B\u0447\u043D\u0443\u044E \u043A\u043E\u043F\u0438\u044E \u044D\u043B\u0435\u043C\u0435\u043D\u0442\u043E\u0432 \u043C\u0430\u0441\u0441\u0438\u0432\u0430.",
  toReversed: "\u0421\u043E\u0437\u0434\u0430\u0451\u0442 \u043D\u043E\u0432\u044B\u0439 \u043C\u0430\u0441\u0441\u0438\u0432 \u0441 \u043E\u0431\u0440\u0430\u0442\u043D\u044B\u043C \u043F\u043E\u0440\u044F\u0434\u043A\u043E\u043C \u044D\u043B\u0435\u043C\u0435\u043D\u0442\u043E\u0432.",
  toSorted: "\u0421\u043E\u0437\u0434\u0430\u0451\u0442 \u043D\u043E\u0432\u044B\u0439 \u043E\u0442\u0441\u043E\u0440\u0442\u0438\u0440\u043E\u0432\u0430\u043D\u043D\u044B\u0439 \u043C\u0430\u0441\u0441\u0438\u0432.",
  toSpliced: "\u0421\u043E\u0437\u0434\u0430\u0451\u0442 \u043D\u043E\u0432\u044B\u0439 \u043C\u0430\u0441\u0441\u0438\u0432 \u0441 \u043F\u0440\u0438\u043C\u0435\u043D\u0451\u043D\u043D\u043E\u0439 \u043E\u043F\u0435\u0440\u0430\u0446\u0438\u0435\u0439 splice.",
  unshift: "\u0414\u043E\u0431\u0430\u0432\u043B\u044F\u0435\u0442 \u044D\u043B\u0435\u043C\u0435\u043D\u0442\u044B \u0432 \u043D\u0430\u0447\u0430\u043B\u043E \u043C\u0430\u0441\u0441\u0438\u0432\u0430 \u0438 \u0432\u043E\u0437\u0432\u0440\u0430\u0449\u0430\u0435\u0442 \u043D\u043E\u0432\u0443\u044E \u0434\u043B\u0438\u043D\u0443.",
  with: "\u0421\u043E\u0437\u0434\u0430\u0451\u0442 \u043A\u043E\u043F\u0438\u044E \u043C\u0430\u0441\u0441\u0438\u0432\u0430 \u0441 \u0437\u0430\u043C\u0435\u043D\u0451\u043D\u043D\u044B\u043C \u044D\u043B\u0435\u043C\u0435\u043D\u0442\u043E\u043C \u043F\u043E \u0438\u043D\u0434\u0435\u043A\u0441\u0443."
};
function arrayMethodDescription(type, name, env) {
  const resolved = resolveType(type, env);
  const arrayLike = resolved.kind === "ArrayType" || resolved.kind === "GenericType" && (resolved.name === "Array" || resolved.name === "ReadonlyArray");
  return arrayLike ? arrayMethodDescriptions[name] : void 0;
}
function narrowHasProperty(type, name, env) {
  const resolved = resolveType(type, env);
  if (isNamedType(resolved, "any")) {
    return { kind: "ObjectType", members: [field(name, named("any"))] };
  }
  if (resolved.kind === "IntersectionType") {
    return { ...resolved, types: resolved.types.map((part) => narrowHasProperty(part, name, env)) };
  }
  if (resolved.kind === "UnionType") {
    const matches = resolved.types.filter((part) => lookupMember(part, name, env) !== void 0);
    return matches.length ? unionOf(matches) : resolved;
  }
  return resolved;
}
function missingUnionMember(type, name, env) {
  const resolved = resolveType(type, env);
  if (resolved.kind === "UnionType") return resolved.types.find((part) => !lookupMember(part, name, env));
  if (resolved.kind === "IntersectionType") {
    for (const part of resolved.types) {
      const missing = missingUnionMember(part, name, env);
      if (missing) return missing;
    }
  }
  return void 0;
}
function isAssignableTo(expected, actual, env) {
  const target = resolveType(expected, env);
  const value = resolveType(actual, env);
  if (isNamedType(target, "any") || isNamedType(value, "any")) return true;
  if (target.kind === "IntersectionType") return target.types.every((part) => isAssignableTo(part, value, env));
  if (value.kind === "IntersectionType") return value.types.some((part) => isAssignableTo(target, part, env));
  if (target.kind === "UnionType") {
    return value.kind === "UnionType" ? value.types.every((valuePart) => target.types.some((targetPart) => isAssignableTo(targetPart, valuePart, env))) : target.types.some((part) => isAssignableTo(part, value, env));
  }
  if (value.kind === "UnionType") return value.types.every((part) => isAssignableTo(target, part, env));
  if (target.kind === "LiteralType") {
    if (value.kind === "LiteralType") return typeof target.value === typeof value.value && target.value === value.value;
    if (value.kind === "NamedType") {
      const literalType = typeof target.value === "string" ? "string" : typeof target.value;
      return value.name === literalType || value.name === "any";
    }
    return false;
  }
  if (value.kind === "LiteralType" && target.kind === "NamedType") {
    return target.name === (typeof value.value === "string" ? "string" : typeof value.value);
  }
  if (target.kind === "ArrayType" && value.kind === "ArrayType") return isAssignableTo(target.element, value.element, env);
  if (target.kind === "ArrayType" && value.kind === "GenericType" && value.name === "Tuple") return value.args.every((element) => isAssignableTo(target.element, element, env));
  if (expected.kind === "ArrayType" && value.kind === "ObjectType") {
    const numeric = value.members.filter((member) => member.indexType && isAssignableTo(member.indexType, named("number"), env) || member.name !== "" && Number.isFinite(Number(member.name)) && String(Number(member.name)) === member.name);
    return numeric.length > 0 && numeric.every((member) => isAssignableTo(expected.element, member.type, env));
  }
  if (target.kind === "FunctionType") {
    const callable = callableType(value, env);
    return Boolean(callable && target.params.length === callable.params.length && target.params.every((item, index) => isAssignableTo(item, callable.params[index], env)) && isAssignableTo(target.result, callable.result, env));
  }
  if (target.kind === "ObjectType" && value.kind === "ObjectType") {
    return target.members.filter((member) => !member.optional && (!member.method || member.accessor === "get") && member.accessor !== "set" && !member.body && !isNullable(member.type, env)).every((member) => {
      const actualMember = value.members.find((item) => item.name === member.name);
      return Boolean(actualMember && isAssignableTo(member.type, actualMember.type, env));
    }) && target.members.filter((member) => !member.method || member.accessor === "get").every((member) => {
      const actualMember = value.members.find((item) => item.name === member.name);
      return !actualMember || isAssignableTo(member.type, actualMember.type, env);
    });
  }
  if (target.kind !== value.kind) return false;
  if (target.kind === "NamedType" && value.kind === "NamedType") return target.name === value.name;
  if (target.kind === "GenericType" && value.kind === "GenericType") return target.name === value.name && target.args.length === value.args.length && target.args.every((item, index) => isAssignableTo(item, value.args[index], env));
  return true;
}
function hostType(source) {
  if (!source) return named("any");
  try {
    const normalized = source.trim().replace(
      /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|;/g,
      (token) => token === ";" ? "," : token
    );
    const declaration = parse(`type __HostType = ${normalized}`, { validate: false })[0];
    if (declaration.kind !== "TypeDeclaration") return named("any");
    const adapt = (type) => {
      if (type.kind === "NamedType" && type.name === "void") return named("null");
      if (type.kind === "NamedType" && type.name === "unknown") return named("any");
      if (type.kind === "GenericType" && type.name === "Iterable") {
        const element = adapt(type.args[0] ?? named("any"));
        return { kind: "ObjectType", members: [method("iterator", [], {
          kind: "FunctionType",
          params: [],
          result: unionOf([
            { kind: "ObjectType", members: [field("value", element)] },
            named("null")
          ])
        })] };
      }
      if (type.kind === "GenericType") return { ...type, args: type.args.map(adapt) };
      if (type.kind === "ArrayType") return { ...type, element: adapt(type.element) };
      if (type.kind === "UnionType" || type.kind === "IntersectionType") return { ...type, types: type.types.map(adapt) };
      if (type.kind === "FunctionType") return { ...type, params: type.params.map(adapt), rest: type.rest && adapt(type.rest), result: adapt(type.result) };
      if (type.kind === "ObjectType") return { ...type, members: type.members.map((member) => ({
        ...member,
        type: adapt(member.type),
        indexType: member.indexType && adapt(member.indexType),
        params: member.params?.map((param) => ({ ...param, type: param.type && adapt(param.type) }))
      })) };
      if (type.kind === "IndexedAccessType") return { ...type, object: adapt(type.object), index: adapt(type.index) };
      if (type.kind === "ConditionalType") return { ...type, check: adapt(type.check), target: adapt(type.target), consequent: adapt(type.consequent), alternate: adapt(type.alternate) };
      return type;
    };
    return adapt(declaration.value);
  } catch {
    return named("any");
  }
}
function hostDeclarations(source) {
  const result = /* @__PURE__ */ new Map();
  const localTypes = /* @__PURE__ */ new Map();
  const numberStatic = (name) => {
    const number = named("number"), boolean = named("boolean"), string = named("string");
    if (["EPSILON", "MAX_SAFE_INTEGER", "MAX_VALUE", "MIN_SAFE_INTEGER", "MIN_VALUE", "NEGATIVE_INFINITY", "POSITIVE_INFINITY", "NaN"].includes(name)) return field(name, number, true);
    if (["isFinite", "isInteger", "isNaN", "isSafeInteger"].includes(name)) return method(name, [{ name: "value", type: number }], boolean);
    if (name === "parseFloat") return method(name, [{ name: "value", type: string }], number);
    if (name === "parseInt") return method(name, [{ name: "value", type: string }, { name: "radix", type: number, defaultValue: { kind: "Literal", value: null } }], number);
    return void 0;
  };
  const splitTopLevel = (value) => {
    const parts = [];
    let start = 0, depth = 0, quote = "";
    for (let index = 0; index < value.length; index++) {
      const character = value[index];
      if (quote) {
        if (character === "\\") index++;
        else if (character === quote) quote = "";
        continue;
      }
      if (character === "'" || character === '"' || character === "`") {
        quote = character;
        continue;
      }
      if ("{[(".includes(character)) depth++;
      else if ("}])".includes(character)) depth--;
      else if (character === "," && depth === 0) {
        parts.push(value.slice(start, index).trim());
        start = index + 1;
      }
    }
    parts.push(value.slice(start).trim());
    return parts.filter(Boolean);
  };
  const resolveLocalType = (type, resolving = /* @__PURE__ */ new Set()) => {
    if (type.kind === "NamedType") {
      const local = localTypes.get(type.name);
      if (local && !resolving.has(type.name)) return resolveLocalType(local, /* @__PURE__ */ new Set([...resolving, type.name]));
      return type;
    }
    if (type.kind === "GenericType") return { ...type, args: type.args.map((argument) => resolveLocalType(argument, resolving)) };
    if (type.kind === "ArrayType") return { ...type, element: resolveLocalType(type.element, resolving) };
    if (type.kind === "UnionType" || type.kind === "IntersectionType") return { ...type, types: type.types.map((part) => resolveLocalType(part, resolving)) };
    if (type.kind === "FunctionType") return { ...type, params: type.params.map((param) => resolveLocalType(param, resolving)), result: resolveLocalType(type.result, resolving) };
    if (type.kind === "ObjectType") return { ...type, members: type.members.map((member) => ({
      ...member,
      type: resolveLocalType(member.type, resolving),
      indexType: member.indexType ? resolveLocalType(member.indexType, resolving) : void 0,
      params: member.params?.map((param) => ({ ...param, type: param.type ? resolveLocalType(param.type, resolving) : void 0 }))
    })) };
    return type;
  };
  const exportedTypes = [];
  for (const match of source.matchAll(/export\s+type\s+([A-Za-z_$][\w$]*)(?:\s*<([^>]+)>)?\s*=\s*/g)) {
    const start = match.index + match[0].length;
    let end = start, depth = 0, quote = "";
    for (; end < source.length; end++) {
      const character = source[end];
      if (quote) {
        if (character === "\\") end++;
        else if (character === quote) quote = "";
        continue;
      }
      if (character === "'" || character === '"' || character === "`") {
        quote = character;
        continue;
      }
      if ("{[<(".includes(character)) depth++;
      else if ("}])".includes(character) || character === ">" && source[end - 1] !== "=") depth--;
      else if ((character === ";" || character === "\n" || character === "\r") && depth === 0) break;
    }
    const generics = match[2]?.split(",").map((item) => item.trim().split(/\s+(?:extends|is)\s+|\s*=/)[0]) ?? [];
    const value = hostType(source.slice(start, end));
    localTypes.set(match[1], value);
    exportedTypes.push({ name: match[1], generics, value });
  }
  for (const match of source.matchAll(/export\s+interface\s+([A-Za-z_$][\w$]*)(?:\s*<([^>{]+)>)?[^\{]*\{/g)) {
    const start = match.index + match[0].length;
    let end = start, depth = 1, quote = "";
    for (; end < source.length && depth > 0; end++) {
      const character = source[end];
      if (quote) {
        if (character === "\\") end++;
        else if (character === quote) quote = "";
        continue;
      }
      if (character === "'" || character === '"' || character === "`") {
        quote = character;
        continue;
      }
      if (character === "{") depth++;
      else if (character === "}") depth--;
    }
    const generics = match[2]?.split(",").map((item) => item.trim().split(/\s+(?:extends|is)\s+|\s*=/)[0]) ?? [];
    const value = hostType(`{${source.slice(start, Math.max(start, end - 1))}}`);
    localTypes.set(match[1], value);
    exportedTypes.push({ name: match[1], generics, value });
  }
  for (const declaration of exportedTypes) result.set(declaration.name, { kind: "type", generics: declaration.generics, value: resolveLocalType(declaration.value) });
  const inferHostValue = (raw) => {
    const value = raw.trim().replace(/;$/, "").trim();
    const assertion = /^(.*?)\s+as\s+([\s\S]+)$/.exec(value);
    if (assertion) return hostType(assertion[2]);
    if (/^['"`]/.test(value)) return named("string");
    if (/^(?:true|false)$/.test(value)) return named("boolean");
    if (/^[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?$/.test(value)) return named("number");
    if (/^[-+]?\d+n$/.test(value)) return named("BigInt");
    if (value === "null") return named("null");
    if (value.startsWith("[") && value.endsWith("]")) {
      const elements = splitTopLevel(value.slice(1, -1)).map(inferHostValue);
      return arrayOf(elements.length ? unionOf(elements) : named("any"));
    }
    if (value.startsWith("{") && value.endsWith("}")) {
      const members = splitTopLevel(value.slice(1, -1)).flatMap((property) => {
        const separator = (() => {
          let depth = 0, quote = "";
          for (let index = 0; index < property.length; index++) {
            const character = property[index];
            if (quote) {
              if (character === "\\") index++;
              else if (character === quote) quote = "";
              continue;
            }
            if (character === "'" || character === '"' || character === "`") {
              quote = character;
              continue;
            }
            if ("{[(".includes(character)) depth++;
            else if ("}])".includes(character)) depth--;
            else if (character === ":" && depth === 0) return index;
          }
          return -1;
        })();
        if (separator < 0) {
          const name2 = property.trim();
          const type = localTypes.get(name2);
          return /^[A-Za-z_$][\w$]*$/.test(name2) ? [field(name2, type ?? named("any"))] : [];
        }
        const rawName = property.slice(0, separator).trim();
        const name = rawName.replace(/^['"]|['"]$/g, "");
        return [field(name, inferHostValue(property.slice(separator + 1)))];
      });
      return { kind: "ObjectType", members };
    }
    return localTypes.get(value) ?? named("any");
  };
  for (const match of source.matchAll(/\b(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?:\:\s*([^=\n]+))?\s*=\s*/g)) {
    const start = match.index + match[0].length;
    let end = start, depth = 0, quote = "";
    for (; end < source.length; end++) {
      const character = source[end];
      if (quote) {
        if (character === "\\") end++;
        else if (character === quote) quote = "";
        continue;
      }
      if (character === "'" || character === '"' || character === "`") {
        quote = character;
        continue;
      }
      if ("{[(".includes(character)) depth++;
      else if ("}])".includes(character)) depth--;
      else if ((character === ";" || character === "\n" || character === "\r") && depth === 0) break;
    }
    localTypes.set(match[1], match[2] ? hostType(match[2]) : inferHostValue(source.slice(start, end)));
  }
  const functions = /export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*(?:<([^>]+)>)?\s*\(((?:[^()]|\((?:[^()]|\([^()]*\))*\))*)\)\s*(?::\s*([^\n{]+))?/g;
  for (const match of source.matchAll(functions)) {
    const params = match[3].trim() ? splitTopLevel(match[3]).map((raw, index) => {
      const part = raw.trim(), rest = part.startsWith("...");
      const clean = rest ? part.slice(3) : part;
      const separator = clean.indexOf(":");
      const rawName = (separator < 0 ? clean : clean.slice(0, separator)).trim();
      const optional = rawName.endsWith("?");
      const name = rawName.replace(/\?$/, "") || `arg${index}`;
      const type = hostType(separator < 0 ? void 0 : clean.slice(separator + 1));
      return { name, type, rest, ...optional ? { defaultValue: { kind: "Literal", value: null } } : {} };
    }) : [];
    const generics = match[2]?.split(",").map((item) => item.trim().split(/\s+(?:extends|is)\s+|\s*=/)[0]) ?? [];
    result.set(match[1], { kind: "fun", generics, params, returnType: hostType(match[4]) });
  }
  const arrowFunctions = /export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:<([^>]+)>\s*)?\(((?:[^()]|\((?:[^()]|\([^()]*\))*\))*)\)\s*(?::\s*([^=\n]+?))?\s*=>\s*([^\n;]+)/g;
  for (const match of source.matchAll(arrowFunctions)) {
    const params = match[3].trim() ? splitTopLevel(match[3]).map((raw, index) => {
      const part = raw.trim(), rest = part.startsWith("...");
      const clean = rest ? part.slice(3) : part;
      const separator = clean.indexOf(":");
      const rawName = (separator < 0 ? clean : clean.slice(0, separator)).trim();
      const optional = rawName.endsWith("?");
      const name = rawName.replace(/\?$/, "") || `arg${index}`;
      const type = hostType(separator < 0 ? void 0 : clean.slice(separator + 1));
      return { name, type, rest, ...optional ? { defaultValue: { kind: "Literal", value: null } } : {} };
    }) : [];
    const body = match[5].trim();
    const inferredReturnType = /^(?:globalThis\.)?Math\.(?:random|abs|ceil|floor|round|trunc|min|max|pow|sqrt|cbrt|hypot|exp|log|log2|log10|sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|fround|imul|clz32)\s*\(/.test(body) || /^[-+]?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?$/.test(body) ? named("number") : /^(?:true|false)$/.test(body) ? named("boolean") : /^(?:["'`])/.test(body) ? named("string") : named("any");
    const generics = match[2]?.split(",").map((item) => item.trim().split(/\s+(?:extends|is)\s+|\s*=/)[0]) ?? [];
    result.set(match[1], { kind: "fun", generics, params, returnType: match[4] ? hostType(match[4]) : inferredReturnType });
  }
  const hostParameters = (source2) => source2.trim() ? splitTopLevel(source2).map((raw, index) => {
    const clean = raw.trim().replace(/^(?:(?:public|private|protected|readonly|override|declare)\s+)+/, "");
    const rest = clean.startsWith("...");
    const parameter = rest ? clean.slice(3) : clean;
    const separator = parameter.indexOf(":");
    const rawName = (separator < 0 ? parameter : parameter.slice(0, separator)).split("=")[0].trim();
    const optional = rawName.endsWith("?") || parameter.includes("=");
    return {
      name: rawName.replace(/\?$/, "") || `arg${index}`,
      type: hostType(separator < 0 ? void 0 : parameter.slice(separator + 1).split("=")[0].trim()),
      rest,
      ...optional ? { defaultValue: { kind: "Literal", value: null } } : {}
    };
  }) : [];
  for (const match of source.matchAll(/export\s+(?:default\s+)?class\s+([A-Za-z_$][\w$]*)(?:\s*<([^>{]+)>)?[^\{]*\{/g)) {
    const name = match[1];
    const bodyStart = match.index + match[0].length;
    let cursor = bodyStart, depth = 1, quote = "";
    for (; cursor < source.length && depth > 0; cursor++) {
      const character = source[cursor];
      if (quote) {
        if (character === "\\") cursor++;
        else if (character === quote) quote = "";
        continue;
      }
      if (character === "'" || character === '"' || character === "`") {
        quote = character;
        continue;
      }
      if (character === "{") depth++;
      else if (character === "}") depth--;
    }
    const body = source.slice(bodyStart, Math.max(bodyStart, cursor - 1));
    const generics = match[2]?.split(",").map((item) => item.trim().split(/\s+(?:extends|is)\s+|\s*=/)[0]) ?? [];
    const constructorMatch = /constructor\s*\(([^)]*)\)/.exec(body);
    const params = hostParameters(constructorMatch?.[1] ?? "");
    const members = [];
    if (constructorMatch) for (const raw of splitTopLevel(constructorMatch[1])) {
      if (!/\b(?:public|readonly)\b/.test(raw)) continue;
      const parameter = hostParameters(raw)[0];
      if (parameter) members.push(field(parameter.name, parameter.type ?? named("any"), /\breadonly\b/.test(raw)));
    }
    for (const fieldMatch of body.matchAll(/(?:^|\n)\s*(?!(?:static|private|protected)\b)(?:public\s+)?(readonly\s+)?([A-Za-z_$][\w$]*)[!?]?\s*:\s*([^=;\n]+)/g)) {
      if (!members.some((member) => member.name === fieldMatch[2])) members.push(field(fieldMatch[2], hostType(fieldMatch[3]), Boolean(fieldMatch[1])));
    }
    const staticMethods = [];
    for (const methodMatch of body.matchAll(/(?:^|\n)\s*(static\s+)?(?:public\s+)?([A-Za-z_$][\w$]*)\s*(?:<([^>]+)>)?\s*\(([^)]*)\)\s*(?::\s*([^\{\n]+))?\s*\{/g)) {
      if (methodMatch[2] === "constructor") continue;
      const methodGenerics = methodMatch[3]?.split(",").map((item) => item.trim().split(/\s+(?:extends|is)\s+|\s*=/)[0]) ?? [];
      const methodParams = hostParameters(methodMatch[4]);
      const returnType = hostType(methodMatch[5]);
      if (methodMatch[1]) staticMethods.push({ name: methodMatch[2], generics: methodGenerics, params: methodParams, returnType });
      else members.push(method(methodMatch[2], methodParams, returnType));
    }
    result.set(name, {
      kind: "constructor",
      generics,
      inheritedType: { kind: "ObjectType", members },
      overloads: [{ params, returnType: generics.length ? { kind: "GenericType", name, args: generics.map(named) } : named(name) }],
      methods: staticMethods
    });
  }
  for (const match of source.matchAll(/export\s+(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) {
    if (!result.has(match[1])) result.set(match[1], { kind: "var", type: localTypes.get(match[1]) ?? named("any") });
  }
  for (const match of source.matchAll(/const\s*\{([^}]+)\}\s*=\s*globalThis\.Number/g)) {
    for (const item of match[1].split(",")) {
      const [sourceName, localName = sourceName] = item.trim().split(/\s*:\s*/);
      const member = numberStatic(sourceName);
      if (!member) continue;
      localTypes.set(localName, member.method ? { kind: "FunctionType", params: (member.params ?? []).map(parameterType), result: member.type } : member.type);
    }
  }
  const assigned = /const\s+([A-Za-z_$][\w$]*)\s*=\s*Object\.assign\s*\(\s*\(([^)]*)\)\s*:\s*([^=\n]+)=>[\s\S]*?,\s*\{([\s\S]*?)\}\s*\)/g;
  for (const match of source.matchAll(assigned)) {
    const callParams = match[2].trim() ? match[2].split(",").map((raw, index) => {
      const separator = raw.indexOf(":");
      const rawName = (separator < 0 ? raw : raw.slice(0, separator)).trim();
      const optional = rawName.includes("?");
      return { name: rawName.replace(/\?/g, "") || `arg${index}`, type: hostType(separator < 0 ? void 0 : raw.slice(separator + 1)), ...optional ? { defaultValue: { kind: "Literal", value: null } } : {} };
    }) : [];
    const members = [{ name: "", optional: false, readonly: false, constant: false, method: true, params: callParams, type: hostType(match[3]) }];
    for (const item of match[4].split(",")) {
      const name = item.trim().match(/^([A-Za-z_$][\w$]*)/)?.[1];
      if (!name) continue;
      const type = localTypes.get(name);
      if (type?.kind === "FunctionType") members.push(method(name, type.params.map((param, index) => ({ name: index === 0 ? "value" : `arg${index}`, type: param })), type.result));
      else if (type) members.push(field(name, type, true));
    }
    localTypes.set(match[1], { kind: "ObjectType", members });
  }
  for (const match of source.matchAll(/export\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\s*;?/g)) {
    const type = localTypes.get(match[2]);
    if (type) result.set(match[1], { kind: "var", type });
  }
  for (const match of source.matchAll(/export\s+(?:const|let|var)\s*\{([^}]+)\}\s*=\s*([^\n;]+)/g)) {
    const sourceExpression = match[2].trim();
    const sourceType = localTypes.get(sourceExpression);
    for (const item of match[1].split(",")) {
      const [sourceName, exportedName = sourceName] = item.trim().split(/\s*:\s*/);
      if (!sourceName) continue;
      if (sourceExpression === "globalThis.String" && ["fromCharCode", "fromCodePoint"].includes(sourceName)) {
        const parameterName = sourceName === "fromCharCode" ? "codes" : "codePoints";
        result.set(exportedName, {
          kind: "fun",
          params: [{ name: parameterName, type: arrayOf(named("number")), rest: true }],
          returnType: named("string")
        });
      } else if (sourceType?.kind === "ObjectType") {
        result.set(exportedName, { kind: "var", type: sourceType.members.find((member) => member.name === sourceName)?.type ?? named("any") });
      } else result.set(exportedName, { kind: "var", type: named("any") });
    }
  }
  for (const match of source.matchAll(/(?:exports\.([A-Za-z_$][\w$]*)|module\.exports\.([A-Za-z_$][\w$]*))\s*=/g)) {
    const name = match[1] ?? match[2];
    if (!result.has(name)) result.set(name, { kind: "var", type: named("any") });
  }
  for (const [name, symbol] of result) {
    if (symbol.kind === "var") result.set(name, { ...symbol, type: resolveLocalType(symbol.type) });
    else if (symbol.kind === "fun") result.set(name, {
      ...symbol,
      params: symbol.params.map((param) => ({ ...param, type: param.type ? resolveLocalType(param.type) : void 0 })),
      returnType: resolveLocalType(symbol.returnType)
    });
    else if (symbol.kind === "constructor") result.set(name, {
      ...symbol,
      inheritedType: resolveLocalType(symbol.inheritedType),
      overloads: symbol.overloads.map((overload) => ({ ...overload, params: overload.params.map((param) => ({ ...param, type: param.type ? resolveLocalType(param.type) : void 0 })), returnType: resolveLocalType(overload.returnType) })),
      methods: symbol.methods.map((item) => ({ ...item, params: item.params.map((param) => ({ ...param, type: param.type ? resolveLocalType(param.type) : void 0 })), returnType: resolveLocalType(item.returnType) }))
    });
  }
  return result;
}
function importedDeclarations(statements, filePath, seen = /* @__PURE__ */ new Set()) {
  const result = /* @__PURE__ */ new Map();
  const fs2 = require("node:fs");
  const path2 = require("node:path");
  const declarationEnv = globals();
  for (const statement of statements) {
    const declaration = statement.kind === "Export" ? statement.declaration : statement;
    if (declaration.kind === "TypeDeclaration") declarationEnv.set(declaration.name, { kind: "type", generics: declaration.generics, value: declaration.value });
  }
  const expandLocalAliases = (type, resolving = /* @__PURE__ */ new Set()) => {
    if (type.kind === "NamedType") {
      const symbol = declarationEnv.get(type.name);
      if (symbol?.kind === "type" && symbol.generics.length === 0 && !resolving.has(type.name)) {
        return expandLocalAliases(symbol.value, /* @__PURE__ */ new Set([...resolving, type.name]));
      }
      return type;
    }
    if (type.kind === "GenericType") {
      const symbol = declarationEnv.get(type.name);
      if (symbol?.kind === "type" && !resolving.has(type.name)) {
        return expandLocalAliases(instantiate(symbol.value, symbol.generics, type.args, symbol.genericDefaults), /* @__PURE__ */ new Set([...resolving, type.name]));
      }
      return { ...type, args: type.args.map((argument) => expandLocalAliases(argument, resolving)) };
    }
    if (type.kind === "UnionType" || type.kind === "IntersectionType") return { ...type, types: type.types.map((part) => expandLocalAliases(part, resolving)) };
    if (type.kind === "ArrayType") return { ...type, element: expandLocalAliases(type.element, resolving) };
    if (type.kind === "IndexedAccessType") return { ...type, object: expandLocalAliases(type.object, resolving), index: expandLocalAliases(type.index, resolving) };
    if (type.kind === "FunctionType") return { ...type, params: type.params.map((param) => expandLocalAliases(param, resolving)), result: expandLocalAliases(type.result, resolving) };
    if (type.kind === "ObjectType") return { ...type, members: type.members.map((member) => ({
      ...member,
      type: expandLocalAliases(member.type, resolving),
      indexType: member.indexType ? expandLocalAliases(member.indexType, resolving) : void 0,
      params: member.params?.map((param) => ({ ...param, type: param.type ? expandLocalAliases(param.type, resolving) : void 0 }))
    })) };
    return type;
  };
  for (const statement of statements) {
    const declaration = statement.kind === "Export" ? statement.declaration : statement;
    const exported = statement.kind === "Export";
    if (declaration.kind === "TypeDeclaration" && exported) result.set(declaration.name, { kind: "type", value: declaration.value, generics: declaration.generics, genericConstraints: declaration.genericConstraints, genericDefaults: declaration.genericDefaults });
    else if (declaration.kind === "FunctionDeclaration" && exported) result.set(declaration.name, {
      kind: "fun",
      generics: declaration.generics,
      genericConstraints: declaration.genericConstraints,
      genericDefaults: declaration.genericDefaults,
      params: declaration.params,
      returnType: expandLocalAliases(functionReturnType(declaration.body, declaration.returnType ?? inferFunctionReturnType2(declaration.body, globals(), declaration.params)))
    });
    else if (declaration.kind === "ConstructorDeclaration" && exported) result.set(declaration.name, {
      kind: "constructor",
      generics: declaration.generics,
      genericConstraints: declaration.genericConstraints,
      genericDefaults: declaration.genericDefaults,
      inheritedType: expandLocalAliases(declaration.inheritedType),
      overloads: declaration.overloads.map((overload) => ({
        params: overload.params.map((param) => ({ ...param, type: param.type ? expandLocalAliases(param.type) : void 0 })),
        returnType: expandLocalAliases(overload.returnType ?? inferFunctionReturnType2(overload.body, declarationEnv, overload.params))
      })),
      methods: declaration.methods.map((method2) => ({
        name: method2.name,
        generics: method2.generics ?? [],
        genericConstraints: method2.genericConstraints,
        genericDefaults: method2.genericDefaults,
        params: method2.params.map((param) => ({ ...param, type: param.type ? expandLocalAliases(param.type) : void 0 })),
        returnType: expandLocalAliases(functionReturnType(method2.body, method2.returnType ?? inferFunctionReturnType2(method2.body, declarationEnv, method2.params)))
      }))
    });
    else if (declaration.kind === "Variable") {
      const type = declaration.type ? expandLocalAliases(declaration.type) : declaration.initializer ? inferExpression(declaration.initializer, declarationEnv) : named("any");
      const symbol = !declaration.mutable && !declaration.type ? genericFunctionExpression(declaration.initializer, declarationEnv) : void 0;
      declarationEnv.set(declaration.name, symbol ?? { kind: "var", mutable: declaration.mutable, type });
      if (exported) result.set(declaration.name, symbol ?? { kind: "var", type });
    } else if (declaration.kind === "Destructure" && exported) {
      const source = inferExpression(declaration.initializer, declarationEnv);
      for (const binding of declaration.bindings) {
        const member = lookupMember(source, binding.name, declarationEnv);
        result.set(binding.name, { kind: "var", type: member && !isFunctionSymbol(member) ? member : named("any") });
      }
    }
  }
  if (!filePath) return result;
  for (const statement of statements) {
    const importedStatement = statement.kind === "Import" ? statement : statement.kind === "Export" && statement.declaration.kind === "Import" ? statement.declaration : void 0;
    if (!importedStatement || !importedStatement.module.startsWith(".") && importedStatement.module !== "juno:async" && importedStatement.module !== "juno:node:fs" && importedStatement.module !== "juno:test" && importedStatement.module !== "juno:types" && !importedStatement.module.startsWith("juno:types/")) continue;
    if (importedStatement.module === "juno:async") {
      const asyncFile = asyncTypeScriptFile();
      let declarations = /* @__PURE__ */ new Map();
      try {
        if (asyncFile) declarations = hostDeclarations(fs2.readFileSync(asyncFile, "utf8"));
      } catch {
      }
      for (const name of importedStatement.namedImports) {
        const symbol = name === "setTimeout" || name === "setInterval" ? asyncImportedSymbol(name) : declarations.get(name) ?? asyncImportedSymbol(name);
        if (symbol && symbol.kind !== "module" && symbol.kind !== "type") result.set(name, symbol);
        else if (symbol?.kind === "type") result.set(name, symbol);
      }
      continue;
    }
    if (importedStatement.module === "juno:node:fs") {
      let directory = path2.dirname(path2.resolve(filePath));
      let workspaceSource;
      while (true) {
        const candidate = path2.join(directory, "Modules", "juno-node-fs.ts");
        if (fs2.existsSync(candidate)) {
          workspaceSource = candidate;
          break;
        }
        const parent = path2.dirname(directory);
        if (parent === directory) break;
        directory = parent;
      }
      const candidates2 = [
        path2.resolve(__dirname, "../../Modules/juno-node-fs.ts"),
        path2.resolve(__dirname, "../../../Modules/juno-node-fs.ts"),
        path2.resolve(process.cwd(), "Modules/juno-node-fs.ts")
      ];
      const file = workspaceSource ?? candidates2.find((candidate) => fs2.existsSync(candidate));
      if (file) {
        const declarations = hostDeclarations(fs2.readFileSync(file, "utf8"));
        for (const [name, symbol] of declarations) {
          if (importedStatement.defaultImport || name === "FileStat" || importedStatement.namedImports.includes(name)) result.set(name, symbol);
        }
      }
      continue;
    }
    if (importedStatement.module === "juno:test") {
      let directory = path2.dirname(path2.resolve(filePath));
      let workspaceSource;
      while (true) {
        const candidate = path2.join(directory, "Modules", "juno-test.jn");
        if (fs2.existsSync(candidate)) {
          workspaceSource = candidate;
          break;
        }
        const parent = path2.dirname(directory);
        if (parent === directory) break;
        directory = parent;
      }
      const candidates2 = [
        path2.resolve(__dirname, "../../Modules/juno-test.jn"),
        path2.resolve(__dirname, "../../../Modules/juno-test.jn"),
        path2.resolve(process.cwd(), "Modules/juno-test.jn")
      ];
      const file = workspaceSource ?? candidates2.find((candidate) => fs2.existsSync(candidate));
      if (file) {
        const declarations = importedDeclarations(parse(fs2.readFileSync(file, "utf8"), { validate: false, filePath: file }));
        for (const name of importedStatement.namedImports) {
          const symbol = declarations.get(name);
          if (symbol) result.set(name, symbol);
        }
      }
      continue;
    }
    let base;
    if (importedStatement.module === "juno:types" || importedStatement.module.startsWith("juno:types/")) {
      const relativeModule = importedStatement.module === "juno:types" ? "index" : importedStatement.module.slice("juno:types/".length);
      let directory = path2.dirname(path2.resolve(filePath));
      let found;
      while (true) {
        const candidate = path2.join(directory, "types", relativeModule);
        if (fs2.existsSync(`${candidate}.jn`) || fs2.existsSync(path2.resolve(candidate, "index.jn"))) {
          found = candidate;
          break;
        }
        const parent = path2.dirname(directory);
        if (parent === directory) break;
        directory = parent;
      }
      base = found ?? path2.resolve(__dirname, "../../types", relativeModule);
    } else base = path2.resolve(path2.dirname(filePath), importedStatement.module);
    const candidates = /\.(?:jn|[cm]?[jt]s)$/i.test(base) ? [base] : [
      `${base}.jn`,
      `${base}.js`,
      `${base}.ts`,
      path2.resolve(base, "index.jn"),
      path2.resolve(base, "index.js"),
      path2.resolve(base, "index.ts")
    ];
    const importedFile = candidates.find((candidate) => fs2.existsSync(candidate));
    if (!importedFile || seen.has(importedFile)) continue;
    seen.add(importedFile);
    try {
      if (!/\.jn$/i.test(importedFile)) {
        const declarations2 = hostDeclarations(fs2.readFileSync(importedFile, "utf8"));
        const signatureFile = `${importedFile}.d.jn`;
        if (fs2.existsSync(signatureFile)) {
          const signatures = parse(fs2.readFileSync(signatureFile, "utf8"), { validate: false, filePath: signatureFile });
          for (const [name, symbol] of importedDeclarations(signatures)) declarations2.set(name, symbol);
        }
        for (const name of importedStatement.namedImports) if (declarations2.has(name)) result.set(name, declarations2.get(name));
        continue;
      }
      const nested = parse(fs2.readFileSync(importedFile, "utf8"), { validate: false, filePath: importedFile });
      const declarations = importedDeclarations(nested, importedFile, seen);
      for (const name of importedStatement.namedImports) if (declarations.has(name)) result.set(name, declarations.get(name));
    } catch {
    } finally {
      seen.delete(importedFile);
    }
  }
  if (statements.some((item) => item.kind === "Import" && item.module === "juno" && item.namedImports.includes("Error"))) {
    result.set("Error", { kind: "type", generics: [], value: { kind: "ObjectType", members: [field("name", named("string")), field("message", named("string")), { ...field("stack", named("string")), optional: true }] } });
  }
  if (statements.some((item) => item.kind === "Import" && item.module === "juno" && item.namedImports.includes("Range"))) {
    let directory = path2.dirname(path2.resolve(filePath));
    let rangeFile;
    while (true) {
      const candidate = path2.join(directory, "types", "range.jn");
      if (fs2.existsSync(candidate)) {
        rangeFile = candidate;
        break;
      }
      const parent = path2.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
    rangeFile ??= path2.resolve(__dirname, "../../types/range.jn");
    if (fs2.existsSync(rangeFile)) {
      try {
        const declarations = importedDeclarations(parse(fs2.readFileSync(rangeFile, "utf8"), { validate: false, filePath: rangeFile }), rangeFile, seen);
        const range = declarations.get("Range");
        if (range) result.set("Range", range);
        const iterableFile = path2.join(path2.dirname(rangeFile), "iterable.jn");
        if (fs2.existsSync(iterableFile)) {
          const iterableDeclarations = importedDeclarations(parse(fs2.readFileSync(iterableFile, "utf8"), { validate: false, filePath: iterableFile }), iterableFile, seen);
          const iterable = iterableDeclarations.get("Iterable");
          if (iterable) result.set("Iterable", iterable);
        }
      } catch {
      }
    }
  }
  const junoConstructors = ["Boolean", "Number", "String"];
  for (const name of junoConstructors) if (statements.some((item) => item.kind === "Import" && item.module === "juno" && item.namedImports.includes(name))) {
    let directory = path2.dirname(path2.resolve(filePath ?? process.cwd()));
    let base;
    while (true) {
      const candidate = path2.join(directory, "types", name.toLowerCase());
      if (fs2.existsSync(`${candidate}.jn`) || fs2.existsSync(`${candidate}.ts`)) {
        base = candidate;
        break;
      }
      const parent = path2.dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
    base ??= path2.resolve(__dirname, "../../types", name.toLowerCase());
    const candidates = [`${base}.jn`, `${base}.ts`];
    const file = candidates.find((candidate) => fs2.existsSync(candidate));
    if (!file) continue;
    try {
      const declarations = /\.jn$/i.test(file) ? importedDeclarations(parse(fs2.readFileSync(file, "utf8"), { validate: false, filePath: file }), file, seen) : hostDeclarations(fs2.readFileSync(file, "utf8"));
      const constructor = declarations.get(name);
      if (constructor) result.set(name, constructor);
    } catch {
    }
  }
  return result;
}
function inferLiteral(value) {
  if (value === null) return named("null");
  if (typeof value === "string") return named("string");
  if (typeof value === "number") return named("number");
  if (typeof value === "bigint") return named("BigInt");
  return named("boolean");
}
function expressionHasAwait(expression) {
  switch (expression.kind) {
    case "Unary":
      return expression.operator === "await" || expressionHasAwait(expression.operand);
    case "Template":
      return expression.parts.some((part) => typeof part !== "string" && expressionHasAwait(part));
    case "Assignment":
      return expressionHasAwait(expression.value);
    case "MemberAssignment":
      return expressionHasAwait(expression.object) || Boolean(expression.index && expressionHasAwait(expression.index)) || expressionHasAwait(expression.value);
    case "Array":
      return expression.elements.some(expressionHasAwait);
    case "Spread":
      return expressionHasAwait(expression.value);
    case "Object":
      return expression.properties.some((property) => property.value.kind !== "Function" && expressionHasAwait(property.value));
    case "Binary":
      return expressionHasAwait(expression.left) || expressionHasAwait(expression.right);
    case "Conditional":
      return expressionHasAwait(expression.condition) || expressionHasAwait(expression.consequent) || expressionHasAwait(expression.alternate);
    case "Match":
      return expressionHasAwait(expression.value) || expression.cases.some((item) => Boolean(item.guard && expressionHasAwait(item.guard)) || statementsHaveAwait(item.body));
    case "Try":
      return Boolean(expression.value && expressionHasAwait(expression.value)) || Boolean(expression.body && statementsHaveAwait(expression.body)) || expression.catches.some((item) => statementsHaveAwait(item.body)) || Boolean(expression.finallyBody && statementsHaveAwait(expression.finallyBody));
    case "Is":
      return expressionHasAwait(expression.value);
    case "Member":
      return expressionHasAwait(expression.object);
    case "Index":
      return expressionHasAwait(expression.object) || expressionHasAwait(expression.index);
    case "Call":
      return expressionHasAwait(expression.callee) || expression.args.some(expressionHasAwait);
    case "Function":
      return false;
    default:
      return false;
  }
}
function statementsHaveAwait(statements) {
  return statements.some((statement) => {
    switch (statement.kind) {
      case "Variable":
        return Boolean(statement.initializer && expressionHasAwait(statement.initializer));
      case "Destructure":
      case "ArrayDestructure":
        return expressionHasAwait(statement.initializer);
      case "Return":
        return Boolean(statement.value && expressionHasAwait(statement.value));
      case "ExpressionStatement":
        return expressionHasAwait(statement.expression);
      case "If":
        return expressionHasAwait(statement.condition) || statementsHaveAwait(statement.consequent) || Boolean(statement.alternate && statementsHaveAwait(statement.alternate));
      case "While":
        return expressionHasAwait(statement.condition) || statementsHaveAwait(statement.body);
      case "ForOf":
        return expressionHasAwait(statement.iterable) || statementsHaveAwait(statement.body);
      case "Export":
        return statementsHaveAwait([statement.declaration]);
      default:
        return false;
    }
  });
}
function functionReturnType(body, declaredOrInferred) {
  return statementsHaveAwait(body) ? promiseOf(awaitedType(declaredOrInferred)) : declaredOrInferred;
}
function expressionFunctionReturnType(expression, declaredOrInferred) {
  const async = expression.expressionBody ? expressionHasAwait(expression.expressionBody) : statementsHaveAwait(expression.body);
  return async ? promiseOf(awaitedType(declaredOrInferred)) : declaredOrInferred;
}
function inferGenericExpression(expression, env) {
  if (expression.kind === "Literal") {
    if (typeof expression.value === "string" || typeof expression.value === "number" || typeof expression.value === "boolean") {
      return { kind: "LiteralType", value: expression.value, loc: expression.loc };
    }
    return inferLiteral(expression.value);
  }
  if (expression.kind === "Array") {
    if (!expression.elements.length) return arrayOf(named("any"));
    const elements = expression.elements.map((item) => item.kind === "Spread" ? spreadElementType(inferExpression(item.value, env), env) ?? named("any") : inferGenericExpression(item, env));
    return arrayOf(unionOf(elements));
  }
  return inferExpression(expression, env);
}
function widenSetElementType(type) {
  if (type.kind === "LiteralType") return inferLiteral(type.value);
  if (type.kind === "UnionType") return unionOf(type.types.map(widenSetElementType));
  if (type.kind === "ArrayType") return { ...type, element: widenSetElementType(type.element) };
  return type;
}
function inferMapArguments(args, env) {
  const keys = [];
  const values = [];
  for (const argument of args) {
    if (argument.kind === "Array" && argument.elements.length >= 2 && argument.elements[0].kind !== "Spread" && argument.elements[1].kind !== "Spread") {
      keys.push(inferGenericExpression(argument.elements[0], env));
      values.push(inferGenericExpression(argument.elements[1], env));
      continue;
    }
    const actual = resolveType(inferExpression(argument, env), env);
    if (actual.kind === "GenericType" && actual.name === "Tuple" && actual.args.length >= 2) {
      keys.push(actual.args[0]);
      values.push(actual.args[1]);
    }
  }
  return [
    widenSetElementType(keys.length ? unionOf(keys) : named("any")),
    widenSetElementType(values.length ? unionOf(values) : named("any"))
  ];
}
function inferGenericArguments(generics, params, args, env) {
  const inferred = /* @__PURE__ */ new Map();
  const collect = (pattern, actual) => {
    if (!pattern) return;
    if (pattern.kind === "NamedType" && generics.includes(pattern.name)) {
      if (!isNamedType(actual, "any")) {
        const previous = inferred.get(pattern.name);
        inferred.set(pattern.name, previous ? unionOf([previous, actual]) : actual);
      }
      return;
    }
    if (pattern.kind === "ArrayType") {
      const resolved = resolveType(actual, env);
      const element = resolved.kind === "ArrayType" ? resolved.element : resolved.kind === "GenericType" && resolved.name === "Array" ? resolved.args[0] : void 0;
      if (element) collect(pattern.element, element);
      return;
    }
    if (pattern.kind === "GenericType") {
      const resolved = resolveType(actual, env);
      if (resolved.kind === "GenericType" && resolved.name === pattern.name) pattern.args.forEach((part, index) => collect(part, resolved.args[index] ?? named("any")));
      else if (pattern.name === "Iterable") {
        const element = resolved.kind === "ArrayType" ? resolved.element : resolved.kind === "GenericType" && resolved.name === "Array" ? resolved.args[0] : iterableElementType(resolved, env);
        if (element) collect(pattern.args[0], element);
      }
      return;
    }
    if (pattern.kind === "FunctionType") {
      const resolved = removeNull(resolveType(actual, env));
      if (resolved.kind === "FunctionType") {
        pattern.params.forEach((part, index) => collect(part, resolved.params[index] ?? named("any")));
        collect(pattern.result, resolved.result);
      }
      return;
    }
    if (pattern.kind === "ObjectType") {
      const resolved = resolveType(actual, env);
      if (resolved.kind === "ObjectType") for (const member of pattern.members) collect(member.type, resolved.members.find((item) => item.name === member.name)?.type ?? named("any"));
    }
  };
  params.forEach((param, index) => {
    if (param.rest) {
      const restType = parameterType(param);
      if (restType.kind === "NamedType" && generics.includes(restType.name)) {
        const elements = args.slice(index).map((arg) => inferExpression(arg, env));
        const element2 = elements.length ? unionOf(elements) : named("any");
        inferred.set(restType.name, {
          kind: "ObjectType",
          members: [
            ...elements.map((type, itemIndex) => ({ name: String(itemIndex), type, optional: false, readonly: true, constant: false })),
            { name: "index", indexType: named("number"), type: element2, optional: false, readonly: true, constant: false },
            { name: "length", type: { kind: "LiteralType", value: elements.length }, optional: false, readonly: true, constant: false },
            { name: "toArray", type: arrayOf(element2), optional: false, readonly: true, constant: false, method: true, params: [] }
          ]
        });
        return;
      }
      const element = restType.kind === "ArrayType" ? restType.element : restType.kind === "GenericType" && restType.name === "Array" ? restType.args[0] : void 0;
      if (element && args.length > index) {
        const actuals = args.slice(index).map((arg) => inferGenericExpression(arg, env));
        const actual = actuals.every((type) => type.kind === "ArrayType") ? arrayOf(unionOf(actuals.map((type) => type.element))) : unionOf(actuals);
        collect(element, actual);
      }
      return;
    }
  });
  params.forEach((param, index) => {
    const arg = args[index];
    if (param.rest || !arg) return;
    const pattern = parameterType(param);
    if (pattern.kind === "FunctionType" && pattern.rest && arg.kind === "Function") {
      const contextual = instantiate(pattern, generics, generics.map((name) => inferred.get(name) ?? named(name)));
      if (contextual.kind === "FunctionType") {
        const callbackParams = arg.params.map((item, i) => ({ ...item, type: item.type ?? contextual.params[i] ?? (contextual.rest?.kind === "ArrayType" ? contextual.rest.element : void 0) }));
        const result = arg.returnType ?? (arg.expressionBody ? inferExpression(arg.expressionBody, bindInferredParameters(callbackParams, env)) : inferFunctionReturnType2(arg.body, env, callbackParams));
        collect(pattern.result, expressionFunctionReturnType(arg, result));
        return;
      }
    }
    collect(pattern, inferGenericExpression(arg, env));
  });
  return generics.map((name) => inferred.get(name) ?? named("any"));
}
function genericFunctionExpression(expression, env) {
  if (expression?.kind !== "Function" || !expression.generics?.length) return void 0;
  const { generics, genericConstraints, genericDefaults, params } = expression;
  const result = expression.returnType ?? (expression.expressionBody ? inferExpression(expression.expressionBody, bindInferredParameters(params, env)) : inferFunctionReturnType2(expression.body, env, params));
  return { kind: "fun", generics, genericConstraints, genericDefaults, params, returnType: expressionFunctionReturnType(expression, result) };
}
function functionGenericArguments(symbol, call, env) {
  const generics = symbol.generics ?? [];
  const inferred = inferGenericArguments(generics, symbol.params, call.args, env);
  return generics.map((_name, index) => call.typeArguments?.[index] ?? (!isNamedType(inferred[index], "any") ? inferred[index] : void 0) ?? symbol.genericDefaults?.[index] ?? named("any"));
}
function constructorMethodForCall(callee, args, env, explicitTypeArguments) {
  if (callee.kind !== "Member" || callee.object.kind !== "Identifier") return void 0;
  const constructor = env.get(callee.object.name);
  if (constructor?.kind !== "constructor") return void 0;
  const method2 = constructor.methods.find((item) => item.name === callee.property);
  if (!method2) return void 0;
  const constructorGenerics = callee.object.name === "Promise" ? [] : constructor.generics;
  const generics = [...constructorGenerics, ...method2.generics];
  const constraints = [...callee.object.name === "Promise" ? [] : constructor.genericConstraints ?? [], ...method2.genericConstraints ?? []];
  const defaults = [...callee.object.name === "Promise" ? [] : constructor.genericDefaults ?? [], ...method2.genericDefaults ?? []];
  const inferredCandidates = inferGenericArguments(generics, method2.params, args, env);
  const inferred = generics.map((_name, index) => {
    const methodIndex = index - constructorGenerics.length;
    const explicit = methodIndex >= 0 ? explicitTypeArguments?.[methodIndex] : void 0;
    return explicit ?? (!isNamedType(inferredCandidates[index], "any") ? inferredCandidates[index] : void 0) ?? defaults[index] ?? (callee.object.name === "Promise" ? named("unknown") : named("any"));
  });
  if (callee.object.name === "Set" || callee.object.name === "ValueSet") {
    for (let index = 0; index < constructor.generics.length; index++) inferred[index] = widenSetElementType(inferred[index]);
  }
  if ((callee.object.name === "Map" || callee.object.name === "ValueMap") && method2.name === "from" && args[0]?.kind === "Array") {
    const entries = args[0].elements.filter((item) => item.kind !== "Spread");
    const [key, value] = inferMapArguments(entries, env);
    inferred[0] = key;
    inferred[1] = value;
  }
  if (callee.object.name === "Array" && method2.name === "from" && constructor.generics[0] && method2.generics[0]) {
    const targetIndex = generics.indexOf(constructor.generics[0]);
    const sourceIndex = generics.indexOf(method2.generics[0]);
    if (args[1]) {
      const callback = args[1];
      if (callback.kind === "Function") {
        const local = bindInferredParameters(callback.params, env);
        if (callback.params[0] && !callback.params[0].type) local.set(callback.params[0].name, { kind: "var", mutable: true, type: inferred[sourceIndex] });
        if (callback.params[1] && !callback.params[1].type) local.set(callback.params[1].name, { kind: "var", mutable: true, type: named("number") });
        inferred[targetIndex] = callback.returnType ?? (callback.expressionBody ? inferExpression(callback.expressionBody, local) : inferFunctionReturnType2(callback.body, local, callback.params));
      } else if (isNamedType(inferred[targetIndex], "any")) inferred[targetIndex] = inferred[sourceIndex];
    } else inferred[targetIndex] = inferred[sourceIndex];
  }
  return {
    params: method2.params.map((param) => ({ ...param, type: param.type ? instantiate(param.type, generics, inferred) : void 0 })),
    returnType: instantiate(method2.returnType, generics, inferred),
    generics,
    constraints,
    typeArguments: inferred
  };
}
var errorType = () => named("<Error-Type>");
function isNamedType(type, name) {
  return type.kind === "NamedType" && type.name === name;
}
function removeNull(type) {
  if (type.kind !== "UnionType") return isNamedType(type, "null") ? named("any") : type;
  return unionOf(type.types.filter((part) => !isNamedType(part, "null")));
}
function iterableElementType(type, env) {
  const resolved = resolveType(type, env);
  if (resolved.kind === "GenericType" && resolved.name === "Tuple" && resolved.args[0]?.kind !== "ObjectType") return unionOf(resolved.args);
  if (resolved.kind === "ArrayType") return resolved.element;
  if (resolved.kind === "GenericType" && (resolved.name === "Array" || resolved.name === "ReadonlyArray")) {
    return resolved.args[0] ?? named("any");
  }
  if (resolved.kind === "UnionType") return unionOf(resolved.types.map((part) => iterableElementType(part, env)));
  if (isNamedType(resolved, "string")) return named("string");
  if (isNamedType(resolved, "Range")) return named("number");
  const arrayElement = (candidate) => {
    const result = resolveType(candidate, env);
    if (result.kind === "ArrayType") return result.element;
    if (result.kind === "GenericType" && (result.name === "Array" || result.name === "ReadonlyArray")) return result.args[0] ?? named("any");
    if (isNamedType(result, "Array") || isNamedType(result, "ReadonlyArray")) return named("any");
    return void 0;
  };
  const toArray = lookupMember(type, "toArray", env);
  if (isFunctionSymbol(toArray)) {
    const element = arrayElement(toArray.returnType);
    if (element) return element;
  }
  const iterator = lookupMember(type, "iterator", env);
  if (isFunctionSymbol(iterator)) {
    const next = removeNull(resolveType(iterator.returnType, env));
    if (next.kind === "FunctionType") {
      const yielded = removeNull(resolveType(next.result, env));
      const value = lookupMember(yielded, "value", env);
      if (value && !isFunctionSymbol(value)) return value;
    }
  }
  return named("any");
}
function spreadElementType(type, env) {
  if (type.kind === "NamedType") {
    const symbol = env.get(type.name);
    if (symbol?.kind === "type") {
      const constraint = resolveType(symbol.value, env);
      if (constraint.kind === "ArrayType" || constraint.kind === "GenericType" && (constraint.name === "Array" || constraint.name === "ReadonlyArray")) {
        return { kind: "IndexedAccessType", object: type, index: named("number") };
      }
    }
  }
  const resolved = resolveType(type, env);
  if (isNamedType(resolved, "any")) return named("any");
  if (isNamedType(resolved, "string")) return named("string");
  if (resolved.kind === "ArrayType") return resolved.element;
  if (resolved.kind === "GenericType" && (resolved.name === "Array" || resolved.name === "ReadonlyArray")) {
    return resolved.args[0] ?? named("any");
  }
  if (resolved.kind === "UnionType" || resolved.kind === "IntersectionType") {
    const elements = resolved.types.map((part) => spreadElementType(part, env));
    if (resolved.kind === "UnionType" && elements.some((element) => !element)) return void 0;
    const available = elements.filter((element) => Boolean(element));
    if (available.length) return unionOf(available);
  }
  const toArray = lookupMember(resolved, "toArray", env);
  if (isFunctionSymbol(toArray) && toArray.params.length === 0) {
    const result = resolveType(toArray.returnType, env);
    if (result.kind === "ArrayType") return result.element;
    if (result.kind === "GenericType" && (result.name === "Array" || result.name === "ReadonlyArray")) {
      return result.args[0] ?? named("any");
    }
    if (isNamedType(result, "Array") || isNamedType(result, "ReadonlyArray")) return named("any");
  }
  return void 0;
}
function isNullable(type, env) {
  const resolved = resolveType(type, env);
  return isNamedType(resolved, "null") || resolved.kind === "UnionType" && resolved.types.some((part) => isNamedType(resolveType(part, env), "null"));
}
function numericFamily(type) {
  if (isNamedType(type, "number") || type.kind === "LiteralType" && typeof type.value === "number") return "number";
  if (isNamedType(type, "BigInt") || type.kind === "LiteralType" && typeof type.value === "bigint") return "BigInt";
  if (type.kind === "UnionType") {
    const families = new Set(type.types.map(numericFamily));
    if (families.size === 1 && !families.has(void 0)) return [...families][0];
  }
  return void 0;
}
function hasSameNumericType(left, right) {
  const family = numericFamily(left);
  return family !== void 0 && family === numericFamily(right);
}
function isStringType(type) {
  return isNamedType(type, "string") || type.kind === "LiteralType" && typeof type.value === "string" || type.kind === "UnionType" && type.types.length > 0 && type.types.every(isStringType);
}
function binaryResultType(operator, left, right) {
  if (operator === "??") {
    const remaining = left.kind === "UnionType" ? left.types.filter((part) => !isNamedType(part, "null")) : isNamedType(left, "null") ? [] : [left];
    return unionOf([...remaining, right]);
  }
  if (operator === "+") {
    if (hasSameNumericType(left, right)) return named(numericFamily(left));
    if (isStringType(left) && isStringType(right)) return named("string");
    return errorType();
  }
  if (["-", "*", "/", "%"].includes(operator)) return hasSameNumericType(left, right) ? named(numericFamily(left)) : errorType();
  if (["<", "<=", ">", ">="].includes(operator)) return hasSameNumericType(left, right) ? named("boolean") : errorType();
  if (["==", "!=", "&", "|"].includes(operator)) return named("boolean");
  return named("any");
}
function binaryErrorMessage(operator, left, right) {
  if (isNamedType(left, "<Error-Type>") || isNamedType(right, "<Error-Type>")) return void 0;
  const leftName = printType(left), rightName = printType(right);
  if (operator === "+" && !(hasSameNumericType(left, right) || isStringType(left) && isStringType(right))) {
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
function pickOmitResult(objectType, args, omit, env) {
  const object = removeNull(resolveType(objectType, env));
  if (object.kind === "ArrayType" || object.kind === "GenericType" && (object.name === "Array" || object.name === "ReadonlyArray")) return object;
  if (object.kind !== "ObjectType") return named("any");
  const keys = new Set(args.flatMap((argument) => {
    const type = inferGenericExpression(argument, env);
    const parts = type.kind === "UnionType" ? type.types : [type];
    return parts.flatMap((part) => part.kind === "LiteralType" && (typeof part.value === "string" || typeof part.value === "number") ? [String(part.value)] : []);
  }));
  if (!keys.size) return omit ? object : { kind: "ObjectType", members: [] };
  return { ...object, members: object.members.filter((member) => member.indexType || (omit ? !keys.has(member.name) : keys.has(member.name))) };
}
function promiseValueType(type, env) {
  const resolved = resolveType(type, env);
  return resolved.kind === "GenericType" && resolved.name === "Promise" ? resolved.args[0] ?? named("unknown") : void 0;
}
function callbackResultType(callback, input, env) {
  if (!callback || callback.kind !== "Function") return named("unknown");
  const local = bindInferredParameters(callback.params, env);
  if (callback.params[0]) local.set(callback.params[0].name, { kind: "var", mutable: true, type: input });
  const result = callback.returnType ?? (callback.expressionBody ? inferExpression(callback.expressionBody, local) : inferFunctionReturnType2(callback.body, local, callback.params));
  return awaitedType(result);
}
function isRejectedResultExpression(expression) {
  if (!expression || expression.kind !== "Object") return false;
  const ok = expression.properties.find((property) => property.key === "ok")?.value;
  return ok?.kind === "Literal" && ok.value === false && expression.properties.some((property) => property.key === "error");
}
function inferExpression(expression, env) {
  switch (expression.kind) {
    case "RegEx":
      return named("RegEx");
    case "Template":
      return named("string");
    case "Literal":
      return inferLiteral(expression.value);
    case "Assignment":
      return inferExpression(expression.value, env);
    case "MemberAssignment":
      return inferExpression(expression.value, env);
    case "Identifier": {
      if (expression.name === "this") {
        const self = env.get("this");
        return self?.kind === "var" ? self.type : named("any");
      }
      const symbol = env.get(expression.name);
      if (!symbol) return named("any");
      if (symbol.kind === "var") return symbol.type;
      if (symbol.kind === "fun") return { kind: "FunctionType", params: symbol.params.map(parameterType), result: symbol.returnType };
      if (symbol.kind === "module") return symbol.type ?? moduleType(symbol.module);
      if (symbol.kind === "constructor") return { kind: "FunctionType", params: symbol.overloads[0]?.params.map(parameterType) ?? [], result: named(expression.name) };
      return named(expression.name);
    }
    case "Array": {
      if (!expression.elements.length) return arrayOf(named("any"));
      const elements = expression.elements.map((item) => item.kind === "Spread" ? spreadElementType(inferExpression(item.value, env), env) ?? errorType() : inferExpression(item, env));
      const resolvedElements = elements.map((item) => resolveType(item, env));
      if (resolvedElements.every((item) => item.kind === "ObjectType")) {
        const objectElements = resolvedElements;
        const memberNames = [...new Set(objectElements.flatMap((item) => item.members.map((member) => member.name)))];
        const members = memberNames.map((name) => {
          const present = objectElements.flatMap((item) => item.members.filter((member) => member.name === name));
          const types = present.map((member) => member.type);
          if (present.length < objectElements.length) types.push(named("null"));
          return field(name, unionOf(types));
        });
        return arrayOf({ kind: "ObjectType", members });
      }
      return arrayOf(unionOf(elements));
    }
    case "Spread":
      return spreadElementType(inferExpression(expression.value, env), env) ?? errorType();
    case "Object": {
      const members = expression.properties.flatMap((property) => {
        if (property.typeOnly && property.indexType && property.declaredType) return [{
          name: property.key,
          loc: property.keyLoc,
          indexType: property.indexType,
          type: property.declaredType,
          optional: false,
          readonly: Boolean(property.readonly),
          sealed: Boolean(property.sealed),
          constant: false
        }];
        if (property.spread) {
          const spread = resolveType(inferExpression(property.value, env), env);
          const members2 = (type) => {
            const resolved = resolveType(type, env);
            if (resolved.kind === "ObjectType") return resolved.members;
            if (resolved.kind === "NamedType") {
              const constructor = env.get(resolved.name);
              if (constructor?.kind === "constructor") return members2(constructor.inheritedType);
            }
            if (resolved.kind === "IntersectionType" || resolved.kind === "UnionType") return resolved.types.flatMap(members2);
            return [];
          };
          return members2(spread);
        }
        if (property.accessor === "get" && property.value.kind === "Function") {
          const result = property.value.returnType ?? inferFunctionReturnType2(property.value.body, env, property.value.params);
          return [{ ...field(property.key, expressionFunctionReturnType(property.value, result)), sealed: Boolean(property.sealed), accessor: "get" }];
        }
        if (property.accessor === "set" && property.value.kind === "Function") {
          const setterType = property.value.params[0] ? parameterBodyType(property.value.params[0]) : named("any");
          return [{ ...field(property.key, setterType), sealed: Boolean(property.sealed), accessor: "set", params: property.value.params }];
        }
        if (property.value.kind === "Function") {
          const result = property.value.returnType ?? (property.value.expressionBody ? inferExpression(property.value.expressionBody, env) : named("any"));
          return [{
            ...method(property.key, property.value.params, expressionFunctionReturnType(property.value, result)),
            sealed: Boolean(property.sealed),
            generics: property.value.generics,
            genericLocs: property.value.genericLocs,
            genericConstraints: property.value.genericConstraints,
            genericDefaults: property.value.genericDefaults
          }];
        }
        return [{ ...field(property.key, inferExpression(property.value, env), property.readonly), sealed: Boolean(property.sealed) }];
      });
      const objectType = { kind: "ObjectType", members };
      const methodEnv = new Map(env);
      methodEnv.set("this", { kind: "var", mutable: false, type: objectType });
      for (const property of expression.properties) {
        if (property.accessor === "set" || property.value.kind !== "Function" || property.value.returnType) continue;
        const index = members.findLastIndex((member) => member.name === property.key);
        if (index >= 0) {
          const inferred = expressionFunctionReturnType(property.value, property.value.expressionBody ? inferExpression(property.value.expressionBody, methodEnv) : inferFunctionReturnType2(property.value.body, methodEnv, property.value.params));
          members[index] = property.accessor === "get" ? { ...field(property.key, inferred), sealed: Boolean(property.sealed), accessor: "get" } : {
            ...method(property.key, property.value.params, inferred),
            sealed: Boolean(property.sealed),
            generics: property.value.generics,
            genericLocs: property.value.genericLocs,
            genericConstraints: property.value.genericConstraints,
            genericDefaults: property.value.genericDefaults
          };
        }
      }
      objectType.members = members.filter((member, index) => {
        const key = `${member.name}:${member.accessor ?? ""}`;
        return members.findLastIndex((item) => `${item.name}:${item.accessor ?? ""}` === key) === index;
      });
      return objectType;
    }
    case "Unary":
      return expression.operator === "await" ? awaitedType(inferExpression(expression.operand, env)) : expression.operator === "postfix!" ? removeNull(inferExpression(expression.operand, env)) : expression.operator.endsWith("++") || expression.operator.endsWith("--") ? inferExpression(expression.operand, env) : expression.operator === "-" ? named("number") : named("boolean");
    case "Conditional":
      return unionOf([inferExpression(expression.consequent, env), inferExpression(expression.alternate, env)]);
    case "Is":
      return named("boolean");
    case "Binary": {
      const left = inferExpression(expression.left, env);
      const right = inferExpression(expression.right, env);
      return binaryResultType(expression.operator, left, right);
    }
    case "Member": {
      if (expression.object.kind === "Identifier") {
        const constructor = env.get(expression.object.name);
        const method2 = constructor?.kind === "constructor" ? constructor.methods.find((item) => item.name === expression.property) : void 0;
        if (method2) return functionType(method2.params, method2.returnType);
      }
      const objectType = inferExpression(expression.object, env);
      const nonNullObjectType = removeNull(resolveType(objectType, env));
      const resolvedObjectType = resolveType(nonNullObjectType, env);
      const member = lookupMember(nonNullObjectType, expression.property, env);
      if (!member) return resolvedObjectType.kind === "ObjectType" ? named("null") : named("any");
      const memberType = isFunctionSymbol(member) ? (() => {
        const genericArguments = member.generics?.map((name, index) => member.genericConstraints?.[index] ?? named(name));
        const parameters = genericArguments ? member.params.map((param) => instantiate(parameterType(param), member.generics, genericArguments)) : member.params.map(parameterType);
        const result = genericArguments ? instantiate(member.returnType, member.generics, genericArguments) : member.returnType;
        return { kind: "FunctionType", params: parameters, result };
      })() : member;
      return expression.optional ? unionOf([memberType, named("null")]) : memberType;
    }
    case "Index": {
      const objectType = inferExpression(expression.object, env);
      return indexedAccessType(objectType, inferGenericExpression(expression.index, env), env) ?? named("any");
    }
    case "Call": {
      if (expression.callee.kind === "Member" && expression.callee.property === "isType") return named("boolean");
      if (expression.callee.kind === "Identifier" && expression.callee.name === "isType") return named("boolean");
      if (expression.callee.kind === "Identifier" && expression.callee.name === "Promise") {
        return promiseOf(awaitedType(expression.typeArguments?.[0] ?? named("unknown")));
      }
      if (expression.callee.kind === "Member" && expression.callee.object.kind === "Identifier" && expression.callee.object.name === "Promise" && expression.callee.property === "resolve") {
        if (isRejectedResultExpression(expression.args[0])) return promiseOf(named("never"));
        const value = expression.typeArguments?.[0] ?? (expression.args[0] ? inferExpression(expression.args[0], env) : named("unknown"));
        return promiseOf(awaitedType(value));
      }
      if (expression.callee.kind === "Member" && expression.callee.object.kind === "Identifier" && expression.callee.object.name === "Promise" && expression.callee.property === "reject") {
        return promiseOf(expression.typeArguments?.[0] ?? named("never"));
      }
      if (expression.callee.kind === "Member" && expression.callee.object.kind === "Identifier" && expression.callee.object.name === "Promise" && ["all", "allSettled", "any", "race"].includes(expression.callee.property)) {
        const values = expression.args[0] ? inferExpression(expression.args[0], env) : arrayOf(named("unknown"));
        const resolved = resolveType(values, env);
        const element = resolved.kind === "ArrayType" ? resolved.element : resolved.kind === "GenericType" && (resolved.name === "Array" || resolved.name === "ReadonlyArray") ? resolved.args[0] ?? named("unknown") : named("unknown");
        if (expression.callee.property === "all") return promiseOf(arrayOf(awaitedType(element)));
        if (expression.callee.property === "allSettled") return promiseOf(arrayOf({ kind: "UnionType", types: [
          { kind: "ObjectType", members: [field("status", { kind: "LiteralType", value: "fulfilled" }), field("value", awaitedType(element))] },
          { kind: "ObjectType", members: [field("status", { kind: "LiteralType", value: "rejected" }), field("reason", named("unknown"))] }
        ] }));
        return promiseOf(awaitedType(element));
      }
      if (expression.callee.kind === "Member" && expression.callee.property === "then") {
        const input = promiseValueType(inferExpression(expression.callee.object, env), env);
        if (input) return promiseOf(callbackResultType(expression.args[0], input, env));
      }
      if (expression.callee.kind === "Member" && expression.callee.property === "catch") {
        const input = promiseValueType(inferExpression(expression.callee.object, env), env);
        if (input) return promiseOf(unionOf([input, callbackResultType(expression.args[0], named("unknown"), env)]));
      }
      {
        const functionSymbol = expression.callee.kind === "Identifier" ? env.get(expression.callee.name) : genericFunctionExpression(expression.callee, env);
        if (functionSymbol?.kind === "fun" && functionSymbol.generics?.length) {
          const typeArguments = functionGenericArguments(functionSymbol, expression, env);
          return instantiate(functionSymbol.returnType, functionSymbol.generics, typeArguments);
        }
      }
      const constructorMethod = constructorMethodForCall(expression.callee, expression.args, env, expression.typeArguments);
      if (constructorMethod) return constructorMethod.returnType;
      if (expression.callee.kind === "Member") {
        if (expression.callee.property === "pick" || expression.callee.property === "omit") {
          return pickOmitResult(inferExpression(expression.callee.object, env), expression.args, expression.callee.property === "omit", env);
        }
        const member = lookupMember(inferExpression(expression.callee.object, env), expression.callee.property, env);
        if (isFunctionSymbol(member) && member.generics?.length) {
          const symbol = { kind: "fun", generics: member.generics, genericConstraints: member.genericConstraints, genericDefaults: member.genericDefaults, params: member.params, returnType: member.returnType };
          return instantiate(member.returnType, member.generics, functionGenericArguments(symbol, expression, env));
        }
      }
      if (expression.callee.kind === "Member" && expression.callee.property === "as" && expression.typeArguments?.length) return expression.typeArguments[0];
      if (expression.callee.kind === "Identifier") {
        const typeSymbol = env.get(expression.callee.name);
        if (typeSymbol?.kind === "type") {
          if (!typeSymbol.generics.length) return named(expression.callee.name);
          const inferred = inferGenericArguments(typeSymbol.generics, [{ name: "value", type: typeSymbol.value }], expression.args, env);
          const args = typeSymbol.generics.map((_name, index) => expression.typeArguments?.[index] ?? (!isNamedType(inferred[index], "any") ? inferred[index] : void 0) ?? typeSymbol.genericDefaults?.[index] ?? named("any"));
          return { kind: "GenericType", name: expression.callee.name, args };
        }
      }
      if (expression.callee.kind === "Identifier") {
        const symbol = env.get(expression.callee.name);
        if (symbol?.kind === "constructor") {
          if (!symbol.generics.length) return named(expression.callee.name);
          const args = expression.typeArguments?.length ? expression.typeArguments : inferGenericArguments(symbol.generics, symbol.overloads[0]?.params ?? [], expression.args, env);
          if (!expression.typeArguments?.length && (expression.callee.name === "Set" || expression.callee.name === "ValueSet" || expression.callee.name === "Queue")) {
            for (let index = 0; index < args.length; index++) args[index] = widenSetElementType(args[index]);
          }
          if (!expression.typeArguments?.length && (expression.callee.name === "Map" || expression.callee.name === "ValueMap")) {
            const [key, value] = inferMapArguments(expression.args, env);
            args[0] = key;
            args[1] = value;
          }
          if (symbol.inheritedType.kind === "ObjectType" && symbol.inheritedType.members.length === 0 && symbol.overloads[0]) {
            return instantiate(symbol.overloads[0].returnType, symbol.generics, args, symbol.genericDefaults);
          }
          return { kind: "GenericType", name: expression.callee.name, args };
        }
      }
      if (expression.callee.kind === "Member" && expression.callee.property === "map" && expression.args[0]?.kind === "Function") {
        const objectType = inferExpression(expression.callee.object, env);
        const member = lookupMember(objectType, expression.callee.property, env);
        const callback = expression.args[0];
        if (isFunctionSymbol(member)) {
          const expected = member.params[0] ? resolveType(parameterType(member.params[0]), env) : void 0;
          const local = bindInferredParameters(callback.params, env);
          if (expected?.kind === "FunctionType") callback.params.forEach((param, index) => {
            if (!param.type && expected.params[index]) {
              local.set(param.name, { kind: "var", mutable: true, type: expected.params[index] });
            }
          });
          const result = callback.returnType ?? (callback.expressionBody ? inferExpression(callback.expressionBody, local) : inferFunctionReturnType2(callback.body, local, callback.params));
          return arrayOf(result);
        }
      }
      const callee = inferExpression(expression.callee, env);
      const callable = callableType(callee, env);
      if (callable) return callable.result;
      if (callee.kind === "UnionType") {
        const results = callee.types.flatMap((part) => {
          const resolved = resolveType(part, env), callable2 = callableType(resolved, env);
          if (callable2) return [callable2.result];
          return isNamedType(resolved, "null") && expression.callee.kind === "Member" && expression.callee.optional ? [named("null")] : [];
        });
        if (results.length) return unionOf(results);
      }
      if (expression.callee.kind === "Identifier") {
        const symbol = env.get(expression.callee.name);
        if (symbol?.kind === "fun") return symbol.returnType;
      }
      if (expression.callee.kind === "Member") {
        const objectType = inferExpression(expression.callee.object, env);
        const member = lookupMember(objectType, expression.callee.property, env);
        if (isFunctionSymbol(member)) {
          if (!member.body) return member.returnType;
          const local = bindInferredParameters(member.params, env);
          local.set("this", { kind: "var", mutable: false, type: member.ownerType ?? objectType });
          return inferFunctionReturnType2(member.body, local, member.params);
        }
      }
      return named("any");
    }
    case "Match": {
      const results = expression.cases.map((item) => inferFunctionReturnType2(item.body, matchCaseEnv(expression, item.pattern, env)));
      if (!expression.cases.some((item) => !item.pattern)) results.push(named("null"));
      return unionOf(results);
    }
    case "Try": {
      const source = resolveType(expression.body ? inferFunctionReturnType2(expression.body, env) : inferExpression(expression.value, env), env);
      let success = named("any");
      const parts = (source.kind === "UnionType" ? source.types : [source]).map((part) => resolveType(part, env));
      const values = parts.flatMap((part) => part.kind === "ObjectType" ? part.members.filter((member) => member.name === "value").map((member) => member.type) : []);
      if (values.length) success = unionOf(values);
      const errors = parts.flatMap((part) => part.kind === "ObjectType" ? part.members.filter((member) => member.name === "error").map((member) => member.type) : []);
      const inferredError = errors.length ? unionOf(errors) : named("Error");
      const caught = expression.catches.map((clause) => {
        const local = new Map(env);
        if (clause.binding) local.set(clause.binding, { kind: "var", mutable: false, type: clause.type ?? inferredError });
        return inferFunctionReturnType2(clause.body, local);
      });
      return unionOf([success, ...caught]);
    }
    case "Function": {
      const result = expression.returnType ?? (expression.expressionBody ? inferExpression(expression.expressionBody, env) : inferFunctionReturnType2(expression.body, env, expression.params));
      return { kind: "FunctionType", params: expression.params.map(parameterType), result: expressionFunctionReturnType(expression, result) };
    }
  }
}
function inferFunctionReturnType2(statements, outer, params = []) {
  const returns = [];
  const collect = (body, env) => {
    for (const statement of body) {
      if (statement.kind === "Return") {
        returns.push(statement.value ? inferExpression(statement.value, env) : named("null"));
      } else if (statement.kind === "If") {
        collect(statement.consequent, narrowedConditionEnvironment(statement.condition, env, true));
        const falseEnv = narrowedConditionEnvironment(statement.condition, env, false);
        if (statement.alternate) collect(statement.alternate, falseEnv);
        else if (statementsDefinitelyReturn(statement.consequent)) {
          for (const [name, symbol] of falseEnv) if (env.has(name)) env.set(name, symbol);
        }
        const guard = negatedMemberTypeGuard(statement.condition);
        if (!statement.alternate && guard && statement.consequent.some((item) => item.kind === "ExpressionStatement" && item.expression.kind === "Assignment" && item.expression.name === guard.name)) {
          const symbol = env.get(guard.name);
          if (symbol?.kind === "var") env.set(guard.name, { ...symbol, type: guard.type });
        }
      } else if (statement.kind === "While" || statement.kind === "ForOf") {
        collect(statement.body, new Map(env));
      } else if (statement.kind === "Variable") {
        env.set(statement.name, { kind: "var", mutable: statement.mutable, type: statement.type ?? (statement.initializer ? inferExpression(statement.initializer, env) : named("any")) });
      } else if (statement.kind === "Destructure") {
        const source = inferExpression(statement.initializer, env);
        for (const binding of statement.bindings) {
          const member = lookupMember(source, binding.name, env);
          env.set(binding.name, { kind: "var", mutable: statement.mutable, type: member && !isFunctionSymbol(member) ? member : named("any") });
        }
      }
    }
  };
  const local = bindInferredParameters(params, outer);
  collect(statements, local);
  return returns.length ? unionOf(returns) : named("null");
}
function statementsDefinitelyReturn(statements) {
  return statements.some((statement) => statement.kind === "Return" || statement.kind === "If" && Boolean(statement.alternate) && statementsDefinitelyReturn(statement.consequent) && statementsDefinitelyReturn(statement.alternate));
}
function narrowedConditionEnvironment(condition, env, whenTruthy) {
  const narrowed = new Map(env);
  if (condition.kind === "Call" && condition.typeArguments?.[0]) {
    const identifier = condition.callee.kind === "Member" && condition.callee.property === "isType" && condition.callee.object.kind === "Identifier" ? condition.callee.object : condition.callee.kind === "Identifier" && condition.callee.name === "isType" && condition.args[0]?.kind === "Identifier" ? condition.args[0] : void 0;
    const narrowedTo = condition.typeArguments[0];
    const symbol = identifier ? narrowed.get(identifier.name) : void 0;
    if (identifier && symbol?.kind === "var") {
      if (whenTruthy) narrowed.set(identifier.name, { ...symbol, type: narrowedTo });
      else {
        const flattenUnion = (type) => type.kind === "UnionType" ? type.types.flatMap(flattenUnion) : [type];
        const parts = flattenUnion(symbol.type);
        const remaining = parts.filter((part) => !isAssignableTo(narrowedTo, part, env));
        narrowed.set(identifier.name, { ...symbol, type: remaining.length ? unionOf(remaining) : named("never") });
      }
    }
  }
  return narrowed;
}
function negatedMemberTypeGuard(condition) {
  if (condition.kind !== "Unary" || condition.operator !== "!" || condition.operand.kind !== "Call") return void 0;
  const call = condition.operand;
  if (call.callee.kind !== "Member" || call.callee.property !== "isType" || call.callee.object.kind !== "Identifier" || !call.typeArguments?.[0]) return void 0;
  return { name: call.callee.object.name, type: call.typeArguments[0] };
}
function unionOf(types) {
  const flatten = (type) => type.kind === "UnionType" ? type.types.flatMap(flatten) : [type];
  const all = types.flatMap(flatten);
  const flattened = all.length > 1 ? all.filter((type) => !isNamedType(type, "never")) : all;
  if (!flattened.length) return named("any");
  const unique = flattened.filter((type, index) => flattened.findIndex((item) => printType(item) === printType(type)) === index);
  return unique.length === 1 ? unique[0] : { kind: "UnionType", types: unique };
}
function functionType(params, returnType) {
  return { kind: "FunctionType", params: params.map(parameterType), result: returnType ?? named("any") };
}
function matchIdentifierType(name, nullable, env) {
  const symbol = env.get(name);
  const base = ["string", "number", "boolean", "bigint", "symbol", "object", "unknown", "any", "null"].includes(name) || symbol?.kind === "type" || symbol?.kind === "constructor" ? named(name) : symbol?.kind === "var" ? symbol.type : named("any");
  return nullable ? unionOf([base, named("null")]) : base;
}
function matchPatternType(pattern, env) {
  if (pattern.kind === "PatternLiteral") return pattern.value === null ? named("null") : typeof pattern.value === "bigint" ? named("bigint") : { kind: "LiteralType", value: pattern.value };
  if (pattern.kind === "PatternIdentifier") return pattern.name === "_" ? named("any") : matchIdentifierType(pattern.name, pattern.nullable, env);
  if (pattern.kind === "PatternUnion") return unionOf(pattern.patterns.map((part) => matchPatternType(part, env)));
  return { kind: "ObjectType", members: pattern.properties.map((property) => field(property.name, property.pattern ? matchPatternType(property.pattern, env) : named("any"))) };
}
function matchPatternBindings(pattern, subject, env) {
  if (pattern.kind === "PatternUnion") {
    const parts = pattern.patterns.map((part) => matchPatternBindings(part, subject, env));
    const names = new Set(parts.flatMap((part) => [...part.keys()]));
    return new Map([...names].map((name) => [name, unionOf(parts.map((part) => part.get(name) ?? named("null")))]));
  }
  if (pattern.kind !== "PatternObject") return /* @__PURE__ */ new Map();
  const bindings = /* @__PURE__ */ new Map();
  for (const property of pattern.properties) {
    const member = lookupMember(subject, property.name, env);
    const contextual = member && !isFunctionSymbol(member) ? member : named("null");
    bindings.set(property.name, property.pattern ? matchPatternType(property.pattern, env) : contextual);
  }
  return bindings;
}
function matchCaseEnv(expression, pattern, env) {
  const local = new Map(env);
  if (!pattern) return local;
  const subject = inferExpression(expression.value, env);
  if (expression.value.kind === "Identifier") {
    const symbol = local.get(expression.value.name);
    if (symbol?.kind === "var") local.set(expression.value.name, { ...symbol, type: matchPatternType(pattern, env) });
  }
  for (const [name, type] of matchPatternBindings(pattern, subject, env)) local.set(name, { kind: "var", mutable: false, type });
  return local;
}
function expandedHoverType(type, env) {
  if (type.kind === "NamedType") {
    const symbol = env.get(type.name);
    if (symbol?.kind === "constructor") {
      return resolveType(symbol.inheritedType, env);
    }
  }
  return resolveType(type, env);
}
function compactType(type, depth = 0) {
  const indent = "  ".repeat(depth);
  const childIndent = "  ".repeat(depth + 1);
  switch (type.kind) {
    case "NamedType":
      return type.name;
    case "LiteralType":
      return typeof type.value === "string" ? JSON.stringify(type.value) : String(type.value);
    case "GenericType":
      return `${type.name}<${type.args.map((argument) => compactType(argument, depth)).join(", ")}>`;
    case "ArrayType": {
      const element = compactType(type.element, depth);
      return `${type.element.kind === "UnionType" || type.element.kind === "IntersectionType" || type.element.kind === "FunctionType" ? `(${element})` : element}[]`;
    }
    case "IndexedAccessType":
      return `${compactType(type.object, depth)}[${compactType(type.index, depth)}]`;
    case "TypeOfType":
      return "typeof<\u2026>";
    case "ConditionalType":
      return `${compactType(type.check, depth)} extends ${compactType(type.target, depth)} ? ${compactType(type.consequent, depth)} : ${compactType(type.alternate, depth)}`;
    case "UnionType":
      return type.types.map((part) => compactType(part, depth)).join(" | ");
    case "IntersectionType":
      return type.types.map((part) => compactType(part, depth)).join(" & ");
    case "FunctionType":
      return `(${type.params.map((parameter, index) => `arg${index}: ${compactType(parameter, depth)}`).join(", ")}) => ${compactType(type.result, depth)}`;
    case "ObjectType": {
      if (!type.members.length) return "{}";
      const members = type.members.map((member) => {
        const modifier = `${member.readonly ? "readonly " : ""}${member.sealed ? "sealed " : ""}${member.constant ? "const " : ""}`;
        const optional = member.optional ? "?" : "";
        const params = (member.params ?? []).map((param) => `${param.rest ? "..." : ""}${param.name}${param.defaultValue !== void 0 ? "?" : ""}: ${compactType(parameterType(param), depth + 1)}`).join(", ");
        if (member.indexType) return `${childIndent}[${member.name}: ${compactType(member.indexType, depth + 1)}]: ${compactType(member.type, depth + 1)};`;
        if (member.accessor === "get") return `${childIndent}${member.sealed ? "sealed " : ""}get ${member.name}(): ${compactType(member.type, depth + 1)};`;
        if (member.accessor === "set") return `${childIndent}${member.sealed ? "sealed " : ""}set ${member.name}(${params}): void;`;
        if (member.method) return `${childIndent}${modifier}${member.name}${optional}(${params}): ${compactType(member.type, depth + 1)};`;
        return `${childIndent}${modifier}${member.name}${optional}: ${compactType(member.type, depth + 1)};`;
      });
      return `{
${members.join("\n")}
${indent}}`;
    }
  }
}
function typeDescription(type, env) {
  return compactType(expandedHoverType(type, env));
}
function symbolTypeDescription(name, symbol, env) {
  if (symbol.kind === "constructor") return typeDescription(named(name), env);
  if (symbol.kind === "var") return typeDescription(symbol.type, env);
  if (symbol.kind === "type") return typeDescription(symbol.value, env);
  if (symbol.kind === "fun") {
    const generics = symbol.generics?.length ? `<${symbol.generics.map((generic, index) => `${generic}${symbol.genericConstraints?.[index] ? ` extends ${compactType(symbol.genericConstraints[index])}` : ""}`).join(", ")}>` : "";
    const params = symbol.params.map((param, index) => `${param.rest ? "..." : ""}${param.name || `arg${index}`}: ${compactType(parameterType(param))}`).join(", ");
    return `${generics}(${params}) => ${compactType(symbol.returnType)}`;
  }
  return void 0;
}
function lengthOf(name, loc) {
  return name.length;
}
var Analyzer = class {
  hovers = [];
  hints = [];
  diagnostics = [];
  semanticTokens = [];
  analyze(statements, builtins = /* @__PURE__ */ new Map()) {
    const env = globals();
    for (const [name, symbol] of builtins) if (symbol.kind === "type") {
      env.set(name, { kind: "type", generics: symbol.generics, genericConstraints: symbol.genericConstraints, genericDefaults: symbol.genericDefaults, value: symbol.value });
    }
    for (const statement of statements) if (statement.kind === "Import") {
      for (const [name, symbol] of Object.entries(statement.importedSymbols ?? {})) {
        if (symbol.kind === "type" && symbol.value) env.set(name, { kind: "type", generics: symbol.generics ?? [], genericConstraints: symbol.genericConstraints, genericDefaults: symbol.genericDefaults, value: symbol.value });
        else if (symbol.kind === "fun" && statement.namedImports.includes(name)) env.set(name, { kind: "fun", generics: symbol.generics, genericConstraints: symbol.genericConstraints, genericDefaults: symbol.genericDefaults, params: symbol.params ?? [], returnType: symbol.returnType ?? named("any") });
        else if (symbol.kind === "var") env.set(name, { kind: "var", mutable: false, type: symbol.type ?? named("any") });
      }
      for (const [name, value] of Object.entries(statement.importedTypes ?? {})) {
        env.set(name, { kind: "type", generics: [], value });
      }
    }
    for (const statement of statements) if (statement.kind === "Import") this.statement(statement, env);
    this.statements(statements, env);
  }
  addHover(name, loc, code, docs, typeDescription2) {
    if (!loc) return;
    this.hovers.push({ line: loc.line, column: loc.column, length: lengthOf(name, loc), code, docs, typeDescription: typeDescription2 });
  }
  addTypeHint(loc, name, hasType, type, kind = "type") {
    if (!loc || hasType) return;
    const printed = printType(type);
    this.hints.push({
      line: loc.line,
      column: loc.column + name.length,
      label: `: ${printed}`,
      tooltip: printed,
      kind
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
      else if (symbol?.kind === "constructor") params = symbol.overloads[0]?.params;
    } else if (callee.kind === "Member") {
      const member = lookupMember(inferExpression(callee.object, env), callee.property, env);
      if (isFunctionSymbol(member)) params = member.params;
    }
    params ??= (() => {
      const callable = callableType(inferExpression(callee, env), env);
      if (!callable) return void 0;
      const call = lookupMember(inferExpression(callee, env), "", env);
      return isFunctionSymbol(call) ? call.params : callable.params.map((type, index) => ({ name: `arg${index}`, type }));
    })();
    if (!params) return;
    let positional = 0;
    args.forEach((arg) => {
      const param = params.find((item, index) => item.rest === true ? positional >= index : index === positional);
      const loc = expressionStart(arg);
      if (!param || !loc) return;
      const inferredParamType = parameterType(param);
      const argumentType = param.rest === true && inferredParamType.kind === "ArrayType" ? inferredParamType.element : inferredParamType;
      this.hints.push({
        line: loc.line,
        column: loc.column,
        label: `${param.name}:`,
        tooltip: `${param.name}: ${printType(argumentType)}`,
        kind: "parameter"
      });
      positional++;
    });
  }
  bind(env, name, symbol) {
    env.set(name, symbol);
  }
  narrowedConditionEnv(condition, env, whenTruthy) {
    const narrowed = narrowedConditionEnvironment(condition, env, whenTruthy);
    if (condition.kind === "Call" && condition.callee.kind === "Member" && condition.callee.property === "has" && condition.callee.object.kind === "Identifier" && whenTruthy) {
      const argument = condition.args[0];
      const argumentSymbol = argument?.kind === "Identifier" ? env.get(argument.name) : void 0;
      const property = argument?.kind === "Literal" && typeof argument.value === "string" ? argument.value : argumentSymbol?.kind === "var" && argumentSymbol.type.kind === "LiteralType" && typeof argumentSymbol.type.value === "string" ? argumentSymbol.type.value : void 0;
      if (property) {
        const objectName = condition.callee.object.name;
        const object = narrowed.get(objectName);
        if (object?.kind === "var") narrowed.set(objectName, { ...object, type: narrowHasProperty(object.type, property, env) });
      }
    }
    if (condition.kind === "Binary" && (condition.operator === "==" || condition.operator === "!=")) {
      const identifier = condition.left.kind === "Identifier" && condition.right.kind === "Literal" && condition.right.value === null ? condition.left : condition.right.kind === "Identifier" && condition.left.kind === "Literal" && condition.left.value === null ? condition.right : void 0;
      if (identifier) {
        const symbol = narrowed.get(identifier.name);
        const isNullBranch = condition.operator === "==" === whenTruthy;
        if (symbol?.kind === "var") narrowed.set(identifier.name, { ...symbol, type: isNullBranch ? named("null") : removeNull(symbol.type) });
      }
    }
    return narrowed;
  }
  statements(statements, env) {
    const declaredHere = /* @__PURE__ */ new Set();
    for (const statement of statements) {
      const candidate = statement.kind === "Export" ? statement.declaration : statement;
      const declarationName = candidate.kind === "Variable" || candidate.kind === "FunctionDeclaration" || candidate.kind === "TypeDeclaration" || candidate.kind === "ConstructorDeclaration" ? candidate.name : void 0;
      if (declarationName && declaredHere.has(declarationName)) {
        const loc = candidate.loc;
        if (loc) this.diagnostics.push({
          line: loc.line,
          column: loc.column,
          length: declarationName.length,
          message: `Duplicate declaration '${declarationName}' in the same scope.`
        });
      }
      if (declarationName) declaredHere.add(declarationName);
      try {
        this.statement(statement, env);
      } catch (error) {
        const loc = candidate.loc ?? ("expression" in candidate ? expressionStart(candidate.expression) : void 0);
        this.diagnostics.push({
          line: loc?.line ?? 1,
          column: loc?.column ?? 1,
          length: Math.max(1, declarationName?.length ?? 1),
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }
  statement(statement, env) {
    switch (statement.kind) {
      case "Import": {
        const imported = statement.module === "juno:node" ? "Node.js helpers for JunoScript (`console.args`, `console.read`, `console.readLines`)." : statement.module === "juno:async" ? "JavaScript promises, timers, fetch, and microtask helpers." : statement.module === "juno:types" || statement.module === "types" ? "Runtime type utilities for transforming Juno type declarations." : "Standard JunoScript module. `console` mirrors the host console.";
        if (statement.defaultImport) {
          const type = statement.module === "juno:node:fs" ? { kind: "ObjectType", members: Object.entries(statement.importedSymbols ?? {}).flatMap(([name, declaration]) => declaration.kind === "fun" ? [method(name, declaration.params ?? [], declaration.returnType ?? named("any"))] : []) } : void 0;
          const symbol = { kind: "module", module: statement.module, type, docs: imported };
          this.bind(env, statement.defaultImport, symbol);
          const printed = printSymbol(statement.defaultImport, symbol);
          this.addHover(statement.defaultImport, statement.defaultImportLoc, printed.code, printed.docs);
        }
        statement.namedImports.forEach((name, index) => {
          const importedAlias = statement.importedTypes?.[name];
          const importedSymbol = statement.importedSymbols?.[name];
          const asyncSymbol = statement.module === "juno:async" ? name === "Promise" ? promiseConstructor() : asyncTypeScriptSymbol(name) ?? asyncImportedSymbol(name) : void 0;
          const itemsImport = name === "Items" && (statement.module === "juno:types" || statement.module === "types");
          const type = importedAlias ? resolveType(importedAlias, env) : importedSymbol?.kind === "var" ? importedSymbol.type ?? named("any") : name === "console" ? consoleType() : name === "Math" && statement.module === "juno" ? mathType() : name === "types" && statement.module === "juno" ? typeUtilitiesType() : (statement.module === "juno:types" || statement.module === "types") && ["Partial", "Required", "Readonly", "Pick", "Omit", "KeyOf", "Exclude"].includes(name) ? typeUtilitiesType().kind === "ObjectType" ? typeUtilitiesType().members.find((member) => member.name === name)?.type ?? named("any") : named("any") : named("any");
          const symbol = asyncSymbol ?? (itemsImport ? { kind: "fun", generics: ["T"], genericConstraints: [{ kind: "UnionType", types: [named("string"), named("number")] }], params: [], returnType: arrayOf(named("T")), docs: "Creates an array from a union of string or number literal types." } : importedSymbol?.kind === "fun" ? { kind: "fun", generics: importedSymbol.generics, genericConstraints: importedSymbol.genericConstraints, genericDefaults: importedSymbol.genericDefaults, params: importedSymbol.params ?? [], returnType: importedSymbol.returnType ?? named("any"), docs: imported } : importedSymbol?.kind === "constructor" && importedSymbol.inheritedType && importedSymbol.overloads ? { kind: "constructor", generics: importedSymbol.generics ?? [], genericConstraints: importedSymbol.genericConstraints, genericDefaults: importedSymbol.genericDefaults, inheritedType: importedSymbol.inheritedType, overloads: importedSymbol.overloads, methods: (importedSymbol.methods ?? []).map((method2) => ({ ...method2, generics: method2.generics ?? [] })), docs: imported } : {
            kind: importedAlias || importedSymbol?.kind === "type" ? "type" : "var",
            mutable: false,
            ...importedAlias || importedSymbol?.kind === "type" ? { generics: importedSymbol?.generics ?? [], genericConstraints: importedSymbol?.genericConstraints, genericDefaults: importedSymbol?.genericDefaults, value: importedAlias ?? importedSymbol?.value ?? named("any") } : { type },
            docs: name === "console" ? statement.module === "juno:node" ? "Console with `log`, `args`, `read`, and `readLines`." : "Host console (`log`, `error`, `warn`)." : name === "Math" && statement.module === "juno" ? "Standard JavaScript Math constants and functions." : name === "types" && statement.module === "juno" ? "Runtime type transformation utilities." : imported
          });
          this.bind(env, name, symbol);
          const printed = printSymbol(name, symbol);
          this.addHover(name, statement.namedImportLocs?.[index], printed.code, printed.docs, symbolTypeDescription(name, symbol, env));
        });
        return;
      }
      case "Export":
        this.statement(statement.declaration, env);
        return;
      case "TypeDeclaration": {
        const symbol = { kind: "type", generics: statement.generics, genericConstraints: statement.genericConstraints, genericDefaults: statement.genericDefaults, value: statement.value };
        this.bind(env, statement.name, symbol);
        const genericEnv = new Map(env);
        statement.generics.forEach((name, index) => genericEnv.set(name, {
          kind: "type",
          generics: [],
          value: statement.genericConstraints?.[index] ?? statement.genericDefaults?.[index] ?? named("any"),
          typeParameter: true
        }));
        this.walkType(statement.value, genericEnv);
        const resolved = resolveType(statement.value, genericEnv);
        const printed = {
          code: `type ${statement.name}${printGenerics(statement.generics, statement.genericConstraints, statement.genericDefaults)} = ${printType(statement.value)}${statement.generics.length ? "" : `
(infer) ${printType(resolved)}`}`
        };
        this.addHover(statement.name, statement.loc, printed.code, void 0, statement.generics.length ? compactType(statement.value) : typeDescription(resolved, genericEnv));
        statement.generics.forEach((name, index) => {
          this.addHover(name, statement.genericLocs?.[index], `(type parameter) ${name}`);
          const constraint = statement.genericConstraints?.[index];
          const defaultType = statement.genericDefaults?.[index];
          if (constraint) this.walkType(constraint, env);
          if (defaultType) {
            this.walkType(defaultType, env);
            if (constraint && !isAssignableTo(constraint, defaultType, env)) this.addDiagnostic(statement.genericLocs?.[index], `Default type '${printType(defaultType)}' does not satisfy constraint '${printType(constraint)}'.`);
          }
        });
        return;
      }
      case "Variable": {
        this.walkExpression(statement.initializer, env, statement.type ? resolveType(statement.type, env) : void 0);
        const type = statement.type ? resolveType(statement.type, env) : statement.initializer ? inferExpression(statement.initializer, env) : named("any");
        if (statement.type && statement.initializer?.kind === "Object") {
          const expected = resolveType(statement.type, env);
          if (expected.kind === "ObjectType") {
            const properties = statement.initializer.properties;
            const actual = inferExpression(statement.initializer, env);
            const actualMembers = actual.kind === "ObjectType" ? actual.members : [];
            for (const property of properties) {
              if (property.spread) continue;
              const numericKey = Number(property.key);
              const keyType = { kind: "LiteralType", value: property.key !== "" && Number.isFinite(numericKey) && String(numericKey) === property.key ? numericKey : property.key };
              const member = expected.members.find((item) => !item.indexType && item.name === property.key) ?? expected.members.find((item) => item.indexType && isAssignableTo(item.indexType, keyType, env));
              if (!member) continue;
              const propertyType = inferExpression(property.value, env);
              const expectedType = member.method ? { kind: "FunctionType", params: (member.params ?? []).map(parameterType), result: member.type } : member.type;
              if (!isAssignableTo(expectedType, propertyType, env)) {
                const label = property.key || "<call signature>";
                if (property.keyLoc) this.diagnostics.push({ line: property.keyLoc.line, column: property.keyLoc.column, length: Math.max(1, property.key.length), message: `Type '${printType(propertyType)}' is not assignable to type '${printType(expectedType)}' for '${label}'.` });
              }
            }
            const missing = expected.members.filter((member) => !member.indexType && !member.optional && (!member.method || member.accessor === "get") && member.accessor !== "set" && !member.defaultValue && !isNullable(member.type, env) && !actualMembers.some((item) => item.name === member.name));
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
        const keyConstraint = statement.initializer?.kind === "Member" && (statement.initializer.property === "pick" || statement.initializer.property === "omit") ? resolveType({ kind: "GenericType", name: "KeyOf", args: [inferExpression(statement.initializer.object, env)] }, env) : void 0;
        const generic = !statement.mutable && !statement.type ? genericFunctionExpression(statement.initializer, env) : void 0;
        const symbol = generic ?? { kind: "var", mutable: statement.mutable, type: statement.type ?? type, keyConstraint };
        this.bind(env, statement.name, symbol);
        const printed = printSymbol(statement.name, symbol);
        let description = symbolTypeDescription(statement.name, symbol, env);
        if (statement.initializer?.kind === "Member" && (statement.initializer.property === "pick" || statement.initializer.property === "omit")) {
          const owner = expressionReference(statement.initializer.object);
          const key = statement.initializer.property === "pick" ? "T" : `Exclude<KeyOf<typeof<${owner}>>, T>`;
          printed.code = `const ${statement.name}: <T is KeyOf<typeof<${owner}>>>(T[]) -> {
    [key: ${key}]: typeof<${owner}[key]>
}`;
          description = `<T extends KeyOf<typeof<${owner}>>>(arg0: T[]) => {
  [key: ${key}]: typeof<${owner}[key]>;
}`;
        }
        if (statement.type && isNamedType(resolveType(statement.type, env), "any") && statement.initializer) {
          printed.code += `
(infer) ${printType(inferExpression(statement.initializer, env))}`;
        }
        this.addHover(statement.name, statement.loc, printed.code, void 0, description);
        this.addTypeHint(statement.loc, statement.name, Boolean(statement.type), type);
        if (statement.type) this.walkType(statement.type, env);
        return;
      }
      case "Destructure": {
        this.walkExpression(statement.initializer, env);
        const source = inferExpression(statement.initializer, env);
        for (const binding of statement.bindings) {
          const member = lookupMember(source, binding.name, env);
          const type = member && !isFunctionSymbol(member) ? member : named("any");
          const symbol = { kind: "var", mutable: statement.mutable, type };
          this.bind(env, binding.name, symbol);
          this.addHover(binding.name, binding.loc, printSymbol(binding.name, symbol).code);
          this.addTypeHint(binding.loc, binding.name, false, type);
          if (!member) this.addDiagnostic(binding.loc, `Property '${binding.name}' does not exist on type '${printType(source)}'.`);
        }
        return;
      }
      case "ArrayDestructure": {
        this.walkExpression(statement.initializer, env);
        const source = inferExpression(statement.initializer, env);
        for (const binding of statement.bindings) {
          if (!binding.name || binding.name === "_") continue;
          const type = binding.rest ? arrayDestructureRestType(source, binding.index, env) : indexedAccessType(source, { kind: "LiteralType", value: binding.index }, env) ?? named("any");
          const symbol = { kind: "var", mutable: statement.mutable, type };
          this.bind(env, binding.name, symbol);
          this.addHover(binding.name, binding.loc, `${statement.mutable ? "let" : "const"} ${binding.name}: ${printType(type)}`, void 0, typeDescription(type, env));
          this.addTypeHint(binding.loc, binding.name, false, type);
        }
        return;
      }
      case "FunctionDeclaration": {
        const genericEnv = new Map(env);
        (statement.generics ?? []).forEach((name, index) => genericEnv.set(name, {
          kind: "type",
          generics: [],
          value: statement.genericConstraints?.[index] ?? statement.genericDefaults?.[index] ?? named("any"),
          typeParameter: true
        }));
        const inferenceEnv = bindInferredParameters(statement.params, genericEnv);
        const returnType = functionReturnType(statement.body, statement.returnType ?? inferFunctionReturnType2(statement.body, inferenceEnv, statement.params));
        const symbol = {
          kind: "fun",
          generics: statement.generics,
          genericConstraints: statement.genericConstraints,
          genericDefaults: statement.genericDefaults,
          params: statement.params,
          returnType
        };
        statement.params.forEach((param, index) => {
          if (!param.type && param.defaultValue !== void 0) symbol.params[index] = { ...param, type: inferenceEnv.get(param.name).type };
        });
        this.bind(env, statement.name, symbol);
        const printed = printSymbol(statement.name, symbol);
        this.addHover(statement.name, statement.loc, printed.code, void 0, symbolTypeDescription(statement.name, symbol, env));
        (statement.generics ?? []).forEach((name, index) => {
          this.addHover(name, statement.genericLocs?.[index], `(type parameter) ${name}`);
          const constraint = statement.genericConstraints?.[index];
          const defaultType = statement.genericDefaults?.[index];
          if (constraint) this.walkType(constraint, env);
          if (defaultType) {
            this.walkType(defaultType, env);
            if (constraint && !isAssignableTo(constraint, defaultType, env)) {
              this.addDiagnostic(statement.genericLocs?.[index], `Default type '${printType(defaultType)}' does not satisfy constraint '${printType(constraint)}'.`);
            }
          }
        });
        const local = bindInferredParameters(statement.params, genericEnv);
        for (const param of statement.params) {
          const bodyType = local.get(param.name).type;
          const type = param.rest ? parameterType(param) : bodyType;
          this.addHover(param.name, param.loc, parameterHover(param, param.rest ? parameterType(param) : bodyType));
          this.addTypeHint(param.loc, param.name, Boolean(param.type), bodyType);
          if (param.type) this.walkType(param.type, env);
          if (param.defaultValue) this.walkExpression(param.defaultValue, local);
        }
        if (statement.returnType) this.walkType(statement.returnType, env);
        this.statements(statement.body, local);
        return;
      }
      case "ConstructorDeclaration": {
        this.walkType(statement.inheritedType, env);
        const constructorEnv = (params) => {
          const genericEnv = new Map(env);
          statement.generics.forEach((name, index) => genericEnv.set(name, {
            kind: "type",
            generics: [],
            value: statement.genericConstraints?.[index] ?? statement.genericDefaults?.[index] ?? named("any"),
            typeParameter: true
          }));
          genericEnv.set(statement.name, { kind: "type", generics: statement.generics, value: statement.inheritedType });
          const local = bindInferredParameters(params, genericEnv);
          if (statement.inheritedType.kind === "GenericType") {
            local.set(statement.inheritedType.name, { kind: "type", generics: [], value: resolveType(statement.inheritedType, env) });
          }
          return local;
        };
        const overloads = statement.overloads.map((overload) => {
          const local = constructorEnv(overload.params);
          const returnType = functionReturnType(overload.body, overload.returnType ?? inferFunctionReturnType2(overload.body, local, overload.params));
          return { params: overload.params, returnType };
        });
        const methods = statement.methods.map((method2) => ({ name: method2.name, generics: method2.generics ?? [], genericConstraints: method2.genericConstraints, genericDefaults: method2.genericDefaults, params: method2.params, returnType: functionReturnType(method2.body, method2.returnType ?? inferFunctionReturnType2(method2.body, env, method2.params)) }));
        const symbol = { kind: "constructor", generics: statement.generics, genericConstraints: statement.genericConstraints, genericDefaults: statement.genericDefaults, inheritedType: statement.inheritedType, overloads, methods };
        this.bind(env, statement.name, symbol);
        this.addHover(statement.name, statement.loc, printSymbol(statement.name, symbol).code, void 0, symbolTypeDescription(statement.name, symbol, env));
        statement.overloads.forEach((overload, index) => {
          const local = constructorEnv(overload.params);
          for (const param of overload.params) {
            const type = local.get(param.name).type;
            this.addHover(param.name, param.loc, parameterHover(param, type));
            this.addTypeHint(param.loc, param.name, Boolean(param.type), type);
            if (param.type) this.walkType(param.type, env);
            if (param.defaultValue) this.walkExpression(param.defaultValue, local);
          }
          this.statements(overload.body, local);
          const actual = overloads[index].returnType;
          const returnsSelf = actual.kind === "NamedType" && actual.name === statement.name || actual.kind === "GenericType" && actual.name === statement.name;
          if (statement.name !== "Array" && !returnsSelf && !isAssignableTo(statement.inheritedType, actual, env)) {
            this.addDiagnostic(statement.loc, `Constructor overload returns '${printType(actual)}', which is not assignable to inherited type '${printType(statement.inheritedType)}'.`);
          }
        });
        statement.methods.forEach((method2, index) => {
          const methodInfo = methods[index];
          const generics = printGenerics(methodInfo.generics, methodInfo.genericConstraints, methodInfo.genericDefaults);
          this.addHover(method2.name, method2.loc, `(method) ${statement.name}.${method2.name}${generics}(${method2.params.map(printParam).join(", ")}): ${printType(methodInfo.returnType)}`, arrayMethodDescriptions[method2.name]);
          const methodEnv = new Map(env);
          methodInfo.generics.forEach((name, genericIndex) => methodEnv.set(name, { kind: "type", generics: [], value: methodInfo.genericConstraints?.[genericIndex] ?? methodInfo.genericDefaults?.[genericIndex] ?? named("any"), typeParameter: true }));
          const local = bindInferredParameters(method2.params, methodEnv);
          method2.params.forEach((param) => {
            const type = local.get(param.name)?.type ?? parameterType(param);
            this.addHover(param.name, param.loc, param.name === "_" ? `(ignored parameter) _: ${printType(type)}` : parameterHover(param, type));
            if (param.name !== "_") this.addTypeHint(param.loc, param.name, Boolean(param.type), type);
          });
          this.statements(method2.body, local);
        });
        return;
      }
      case "Return":
        this.walkExpression(statement.value, env);
        return;
      case "Break":
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
        if (isNullable(inferExpression(statement.condition, env), env)) this.addDiagnostic(expressionStart(statement.condition), "Nullable value cannot be used as a condition; use ! or ?? to handle null.");
        this.statements(statement.consequent, this.narrowedConditionEnv(statement.condition, env, true));
        if (statement.alternate) this.statements(statement.alternate, this.narrowedConditionEnv(statement.condition, env, false));
        else if (statementsDefinitelyReturn(statement.consequent)) {
          const continuation = this.narrowedConditionEnv(statement.condition, env, false);
          for (const [name, symbol] of continuation) if (env.has(name)) env.set(name, symbol);
        }
        const guard = negatedMemberTypeGuard(statement.condition);
        if (!statement.alternate && guard && statement.consequent.some((item) => item.kind === "ExpressionStatement" && item.expression.kind === "Assignment" && item.expression.name === guard.name)) {
          const symbol = env.get(guard.name);
          if (symbol?.kind === "var") env.set(guard.name, { ...symbol, type: guard.type });
        }
        return;
      }
      case "While":
        this.walkExpression(statement.condition, env);
        if (isNullable(inferExpression(statement.condition, env), env)) this.addDiagnostic(expressionStart(statement.condition), "Nullable value cannot be used as a condition; use ! or ?? to handle null.");
        this.statements(statement.body, this.narrowedConditionEnv(statement.condition, env, true));
        return;
      case "ForOf": {
        this.walkExpression(statement.iterable, env);
        const iterable = inferExpression(statement.iterable, env);
        const bindingType = iterableElementType(iterable, env);
        const local = new Map(env);
        this.bind(local, statement.binding, { kind: "var", mutable: statement.mutable, type: bindingType });
        this.addHover(statement.binding, statement.loc, `${statement.mutable ? "let" : "const"} ${statement.binding}: ${printType(bindingType)}`);
        this.addTypeHint(statement.loc, statement.binding, false, bindingType);
        this.statements(statement.body, local);
        return;
      }
    }
  }
  walkType(type, env, thisType) {
    switch (type.kind) {
      case "NamedType": {
        const symbol = env.get(type.name);
        if (symbol) {
          const printed = printSymbol(type.name, symbol);
          if (symbol.kind === "type" && symbol.generics.length === 0) printed.code += `
(infer) ${printType(resolveType(type, env))}`;
          this.addHover(type.name, type.loc, printed.code, printed.docs, symbolTypeDescription(type.name, symbol, env));
        } else this.addHover(type.name, type.loc, `(type) ${type.name}`);
        return;
      }
      case "LiteralType":
        return;
      case "GenericType": {
        const symbol = env.get(type.name);
        if (["Partial", "Required", "Readonly", "Pick", "Omit", "KeyOf", "Exclude"].includes(type.name)) {
          const parameters = type.name === "Pick" || type.name === "Omit" || type.name === "Exclude" ? "<T, U>" : type.name === "KeyOf" ? "<T is object>" : "<T>";
          const inferred = resolveType(type, env);
          this.addHover(type.name, type.loc, `type ${type.name}${parameters}
(infer) ${printType(inferred)}`, void 0, typeDescription(inferred, env));
          if (type.name === "KeyOf" && type.args[0]) {
            const source = resolveType(type.args[0], env);
            const objectLike = isNamedType(source, "object") || source.kind === "ObjectType" || source.kind === "ArrayType" || source.kind === "GenericType" && (source.name === "Array" || source.name === "ReadonlyArray");
            if (!objectLike) this.addDiagnostic(type.args[0].loc, `Type '${printType(type.args[0])}' does not satisfy constraint 'object'.`);
          }
        } else if (symbol && symbol.kind !== "type") {
          const printed = printSymbol(type.name, symbol);
          this.addHover(type.name, type.loc, printed.code, printed.docs, symbolTypeDescription(type.name, symbol, env));
        } else {
          const resolved = resolveType(type, env);
          const short = `(type) ${printType(type)}`;
          this.addHover(type.name, type.loc, short, void 0, typeDescription(resolved, env));
        }
        type.args.forEach((arg) => this.walkType(arg, env));
        return;
      }
      case "UnionType":
      case "IntersectionType":
        type.types.forEach((part) => this.walkType(part, env, thisType ?? type));
        return;
      case "ArrayType":
        this.walkType(type.element, env);
        return;
      case "IndexedAccessType": {
        this.walkType(type.object, env);
        this.walkType(type.index, env);
        const inferred = resolveType(type, env);
        this.addHover("[", type.loc, `(indexed access) ${printType(type)}
(infer) ${printType(inferred)}`, void 0, typeDescription(inferred, env));
        return;
      }
      case "TypeOfType": {
        this.walkExpression(type.expression, env);
        const inferred = resolveType(type, env);
        this.addHover("typeof", type.loc, `type typeof<\u2026>
(infer) ${printType(inferred)}`, void 0, typeDescription(inferred, env));
        return;
      }
      case "ConditionalType":
        this.walkType(type.check, env);
        this.walkType(type.target, env);
        this.walkType(type.consequent, env);
        this.walkType(type.alternate, env);
        return;
      case "FunctionType":
        type.params.forEach((param) => this.walkType(param, env));
        this.walkType(type.result, env);
        return;
      case "ObjectType":
        for (const member of type.members) {
          if (!member.method || !member.body) continue;
          const local = new Map(env);
          (member.generics ?? []).forEach((name, index) => local.set(name, { kind: "type", generics: [], value: member.genericConstraints?.[index] ?? member.genericDefaults?.[index] ?? named("any"), typeParameter: true }));
          this.bind(local, "this", { kind: "var", mutable: false, type: thisType ?? type });
          for (const param of member.params ?? []) {
            const paramType = parameterBodyType(param);
            this.bind(local, param.name, { kind: "var", mutable: true, type: paramType });
            if (param.defaultValue) this.walkExpression(param.defaultValue, local);
          }
          if (isNamedType(member.type, "any")) member.type = inferFunctionReturnType2(member.body, local, member.params ?? []);
          this.statements(member.body, local);
        }
        for (const member of type.members) {
          const signature = member.indexType ? `(index signature) [${member.name}: ${printType(member.indexType)}]: ${printType(member.type)}
(infer) typeof<obj[${member.name}]> = ${printType(member.type)}` : member.accessor === "get" ? `(getter) ${member.name}: ${printType(member.type)}` : member.accessor === "set" ? `(setter) ${member.name}(${(member.params ?? []).map(printParam).join(", ")})` : member.method ? `(method) ${member.sealed ? "sealed " : ""}${member.name}${printGenerics(member.generics ?? [], member.genericConstraints, member.genericDefaults)}(${(member.params ?? []).map(printParam).join(", ")}): ${printType(member.type)}` : `(property) ${member.readonly ? "readonly " : ""}${member.sealed ? "sealed " : ""}${member.name}${member.optional ? "?" : ""}: ${printType(member.type)}`;
          this.addHover(member.name, member.loc, signature);
          const memberEnv = member.indexType ? new Map(env) : env;
          if (member.indexType) memberEnv.set(member.name, { kind: "type", generics: [], value: resolveType(member.indexType, env) });
          this.walkType(member.type, memberEnv);
          if (member.method) {
            ;
            (member.generics ?? []).forEach((name, index) => {
              this.addHover(name, member.genericLocs?.[index], `(type parameter) ${name}`);
              const constraint = member.genericConstraints?.[index];
              const defaultType = member.genericDefaults?.[index];
              if (constraint) this.walkType(constraint, env);
              if (defaultType) {
                this.walkType(defaultType, env);
                if (constraint && !isAssignableTo(constraint, defaultType, env)) this.addDiagnostic(member.genericLocs?.[index], `Default type '${printType(defaultType)}' does not satisfy constraint '${printType(constraint)}'.`);
              }
            });
            for (const param of member.params ?? []) {
              const paramType = parameterBodyType(param);
              this.addHover(param.name, param.loc, parameterHover(param, paramType));
              this.addTypeHint(param.loc, param.name, Boolean(param.type), paramType);
              if (param.type) this.walkType(param.type, env);
            }
          }
        }
    }
  }
  walkExpression(expression, env, thisType) {
    if (!expression) return;
    switch (expression.kind) {
      case "RegEx":
        this.addHover(`/${expression.source}/${expression.flags}`, expression.loc, `(RegEx) /${expression.source}/${expression.flags}`);
        return;
      case "Literal":
        this.addHover(literalLabel(expression.value), expression.loc, `(${printType(inferLiteral(expression.value))}) ${literalPreview(expression.value)}`);
        return;
      case "Template":
        for (const part of expression.parts) if (typeof part !== "string") this.walkExpression(part, env, thisType);
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
          this.addHover(expression.name, expression.loc, printed.code, printed.docs, symbolTypeDescription(expression.name, symbol, env));
        } else if (expression.loc) {
          this.diagnostics.push({
            line: expression.loc.line,
            column: expression.loc.column,
            length: expression.name.length,
            message: `Cannot find name '${expression.name}'.`
          });
        }
        return;
      }
      case "Array":
        expression.elements.forEach((item) => this.walkExpression(item, env, thisType));
        if (expression.loc) this.hovers.push({
          line: expression.loc.line,
          column: expression.loc.column,
          length: 1,
          code: `(infer) ${printType(inferExpression(expression, env))}`
        });
        return;
      case "Spread": {
        this.walkExpression(expression.value, env, thisType);
        const source = inferExpression(expression.value, env);
        const element = spreadElementType(source, env);
        if (expression.loc) {
          this.hovers.push({
            line: expression.loc.line,
            column: expression.loc.column,
            length: 3,
            code: element ? `(spread) ${printType(source)}
(infer) ${printType(element)}` : `(spread) ${printType(source)}`
          });
          if (!element) this.diagnostics.push({
            line: expression.loc.line,
            column: expression.loc.column,
            length: 3,
            message: `Type '${printType(source)}' cannot be spread. Expected string, an array, or an object with toArray(): Array.`
          });
        }
        return;
      }
      case "Assignment":
        if (!env.has(expression.name) && expression.loc) this.diagnostics.push({
          line: expression.loc.line,
          column: expression.loc.column,
          length: expression.name.length,
          message: `Cannot find name '${expression.name}'.`
        });
        this.walkExpression(expression.value, env, thisType);
        return;
      case "MemberAssignment":
        this.walkExpression(expression.object, env, thisType);
        if (expression.index?.kind === "Literal") {
          const objectType = inferExpression(expression.object, env);
          const readonlyArray = objectType.kind === "GenericType" && objectType.name === "ReadonlyArray";
          const resolved = objectType.kind === "GenericType" && env.get(objectType.name)?.kind === "constructor" ? resolveType(instantiate(env.get(objectType.name).inheritedType, env.get(objectType.name).generics, objectType.args), env) : resolveType(objectType, env);
          const readonlyMember = resolved.kind === "ObjectType" ? resolved.members.find((member) => member.name === String(expression.index.value) && member.readonly) : resolved.kind === "IntersectionType" ? resolved.types.flatMap((part) => part.kind === "ObjectType" ? part.members : []).find((member) => member.name === String(expression.index.value) && member.readonly) : void 0;
          if (readonlyArray || readonlyMember) this.addDiagnostic(expression.loc, `Cannot assign to readonly index '${String(expression.index.value)}'.`);
          const sealedMember = resolved.kind === "ObjectType" ? resolved.members.find((member) => member.name === String(expression.index.value) && member.sealed) : void 0;
          if (sealedMember) this.addDiagnostic(expression.loc, `Cannot override sealed member '${String(expression.index.value)}'.`);
        }
        if (expression.property) {
          const objectType = inferExpression(expression.object, env);
          const resolvedObject = resolveType(objectType, env);
          const readonlyProperty = resolvedObject.kind === "ObjectType" ? resolvedObject.members.find((item) => item.name === expression.property && item.readonly) : void 0;
          if (readonlyProperty) this.addDiagnostic(expression.propertyLoc ?? expression.loc, `Cannot assign to readonly property '${expression.property}'.`);
          const sealedProperty = resolvedObject.kind === "ObjectType" ? resolvedObject.members.find((item) => item.name === expression.property && item.sealed) : void 0;
          if (sealedProperty) this.addDiagnostic(expression.propertyLoc ?? expression.loc, `Cannot override sealed member '${expression.property}'.`);
          const setter = lookupAccessor(objectType, expression.property, "set", env);
          const member = setter ?? lookupMember(objectType, expression.property, env);
          const code = setter ? `(setter) ${setter.name}(${(setter.params ?? []).map(printParam).join(", ")})` : isFunctionSymbol(member) ? `(method) ${expression.property}(${member.params.map(printParam).join(", ")}): ${printType(member.returnType)}` : `(property) ${expression.property}: ${printType(member && !isFunctionSymbol(member) ? member : named("any"))}`;
          this.addHover(expression.property, expression.propertyLoc, code);
        }
        this.walkExpression(expression.value, env, thisType);
        return;
      case "Object": {
        const objectType = thisType ? resolveType(thisType, env) : inferExpression(expression, env);
        const methodEnv = new Map(env);
        const sealedMembers = /* @__PURE__ */ new Set();
        this.bind(methodEnv, "this", { kind: "var", mutable: false, type: objectType });
        for (const property of expression.properties) {
          if (property.typeOnly) {
            this.walkType(property.indexType, env);
            this.walkType(property.declaredType, env);
            continue;
          }
          if (property.spread) {
            const spreadType = resolveType(inferExpression(property.value, env), env);
            const spreadMembers = spreadType.kind === "ObjectType" ? spreadType.members : [];
            for (const member2 of spreadMembers) {
              if (sealedMembers.has(member2.name)) this.addDiagnostic(property.keyLoc, `Cannot override sealed member '${member2.name}'.`);
              if (member2.sealed) sealedMembers.add(member2.name);
            }
            this.walkExpression(property.value, env, thisType);
            continue;
          }
          if (sealedMembers.has(property.key)) this.addDiagnostic(property.keyLoc, `Cannot override sealed member '${property.key}'.`);
          if (property.sealed) sealedMembers.add(property.key);
          const member = lookupMember(objectType, property.key, env);
          const code = isFunctionSymbol(member) ? property.key === "" ? `(call) ${printGenerics(member.generics ?? [], member.genericConstraints, member.genericDefaults)}(${member.params.map(printParam).join(", ")}): ${printType(member.returnType)}` : `(method) ${property.sealed ? "sealed " : ""}${property.key}${printGenerics(member.generics ?? [], member.genericConstraints, member.genericDefaults)}(${member.params.map(printParam).join(", ")}): ${printType(member.returnType)}` : `(property) ${property.key}: ${printType(member && !isFunctionSymbol(member) ? member : named("any"))}`;
          this.addHover(property.key, property.keyLoc, code);
          if (property.key && property.keyLoc && isFunctionSymbol(member)) {
            this.semanticTokens.push({
              line: property.keyLoc.line,
              column: property.keyLoc.column,
              length: property.key.length,
              type: "method"
            });
          }
          if (property.value.kind === "Identifier" && property.key === property.value.name) {
            const symbol = env.get(property.value.name);
            if (symbol) {
              const printed = printSymbol(property.value.name, symbol);
              this.addHover(property.value.name, property.value.loc, printed.code, printed.docs);
            } else this.walkExpression(property.value, env, thisType);
          } else if (property.value.kind === "Function") this.walkFunction(property.value, methodEnv);
          else this.walkExpression(property.value, env, thisType);
        }
        return;
      }
      case "Unary":
        this.walkExpression(expression.operand, env, thisType);
        if (expression.operator !== "postfix!" && expression.operator !== "await" && isNullable(inferExpression(expression.operand, env), env)) this.addDiagnostic(expression.loc, "Nullable value cannot be used with this operator; use ! or ?? to handle null.");
        if (expression.operator === "await" && expression.loc) this.addHover("await", expression.loc, `(await) ${printType(inferExpression(expression, env))}`);
        return;
      case "Binary": {
        this.walkExpression(expression.left, env, thisType);
        this.walkExpression(expression.right, env, thisType);
        const leftType = inferExpression(expression.left, env), rightType = inferExpression(expression.right, env);
        const nullComparison = ["==", "!="].includes(expression.operator) && (expression.left.kind === "Literal" && expression.left.value === null || expression.right.kind === "Literal" && expression.right.value === null);
        if (expression.operator !== "??" && !nullComparison && (isNullable(leftType, env) || isNullable(rightType, env))) {
          this.addDiagnostic(expression.loc, "Nullable value cannot be used with this operator; use ! or ?? to handle null.");
        } else {
          const message = binaryErrorMessage(expression.operator, leftType, rightType);
          if (message) this.addDiagnostic(expression.loc, message);
        }
        return;
      }
      case "Index": {
        this.walkExpression(expression.object, env, thisType);
        this.walkExpression(expression.index, env, thisType);
        const objectType = inferExpression(expression.object, env);
        const keyType = inferGenericExpression(expression.index, env);
        if (isNullable(objectType, env)) this.addDiagnostic(expression.loc, "Cannot index a nullable value; use ! or ?? to handle null.");
        const resultType = indexedAccessType(objectType, keyType, env);
        const dependentKey = expression.index.kind === "Identifier" && env.get(expression.index.name)?.kind === "type";
        if (!resultType && !dependentKey) this.addDiagnostic(expressionStart(expression.index) ?? expression.loc, `Type '${printType(keyType)}' cannot be used to index type '${printType(objectType)}'.`);
        if (expression.loc) {
          this.hovers.push({
            line: expression.loc.line,
            column: expression.loc.column,
            length: 1,
            code: `(index) ${printType(objectType)}[${printType(keyType)}]
(infer) ${printType(resultType ?? named("any"))}`
          });
        }
        return;
      }
      case "Member": {
        this.walkExpression(expression.object, env, thisType);
        if (expression.object.kind === "Identifier") {
          const constructor = env.get(expression.object.name);
          const method2 = constructor?.kind === "constructor" ? constructor.methods.find((item) => item.name === expression.property) : void 0;
          if (method2) {
            const generics = printGenerics(method2.generics, method2.genericConstraints, method2.genericDefaults);
            this.addHover(expression.property, expression.loc, `(method) ${expression.object.name}.${method2.name}${generics}(${method2.params.map(printParam).join(", ")}): ${printType(method2.returnType)}`, arrayMethodDescriptions[method2.name]);
            return;
          }
        }
        const objectType = inferExpression(expression.object, env);
        const nullableObject = isNullable(objectType, env);
        const nonNullObjectType = removeNull(resolveType(objectType, env));
        const resolvedObjectType = resolveType(nonNullObjectType, env);
        const member = lookupMember(nonNullObjectType, expression.property, env);
        const assertedUniversalMember = expression.object.kind === "Unary" && expression.object.operator === "postfix!" && expression.property === "toString";
        if (isNamedType(resolvedObjectType, "any") && !["isType", "has"].includes(expression.property) && !assertedUniversalMember) {
          this.diagnostics.push({
            line: expression.loc?.line ?? 1,
            column: expression.loc?.column ?? 1,
            length: expression.property.length,
            message: `Cannot access '${expression.property}' on type 'any'; check the value with isType<T>() or has() first.`
          });
        }
        if (nullableObject && !expression.optional && expression.property !== "isType") this.diagnostics.push({ line: expression.loc?.line ?? 1, column: expression.loc?.column ?? 1, length: expression.property.length, message: `Cannot access '${expression.property}' on a nullable value; use ! or ?., or ?? to handle null.` });
        if (isFunctionSymbol(member)) {
          const signature = expression.property === "as" ? "(method) as<T>(): T" : `(method) ${expression.property}${printGenerics(member.generics ?? [], member.genericConstraints, member.genericDefaults)}(${member.params.map(printParam).join(", ")}): ${printType(member.returnType)}`;
          this.addHover(expression.property, expression.loc, signature, arrayMethodDescription(nonNullObjectType, expression.property, env));
        } else if (member) {
          this.addHover(expression.property, expression.loc, `(property) ${expression.property}: ${printType(member)}`);
        } else if (nonNullObjectType.kind === "GenericType" && (env.get(nonNullObjectType.name)?.kind === "constructor" || nonNullObjectType.name === "ReadonlyArray")) {
          if (expression.loc) this.diagnostics.push({
            line: expression.loc.line,
            column: expression.loc.column,
            length: expression.property.length,
            message: `Property '${expression.property}' does not exist on type '${printType(nonNullObjectType)}'.`
          });
        } else if (resolvedObjectType.kind === "UnionType") {
          const missingPart = resolvedObjectType.types.find((part) => !lookupMember(part, expression.property, env));
          if (missingPart && expression.loc) this.diagnostics.push({
            line: expression.loc.line,
            column: expression.loc.column,
            length: expression.property.length,
            message: `Property '${expression.property}' does not exist on type '${printType(objectType)}'.
  Property '${expression.property}' does not exist on type '${printType(missingPart)}'.`
          });
        } else if (resolvedObjectType.kind === "ObjectType") {
          if (expression.loc) this.diagnostics.push({
            line: expression.loc.line,
            column: expression.loc.column,
            length: expression.property.length,
            message: `Property '${expression.property}' does not exist on type '${printType(objectType)}'.`
          });
        } else {
          const missingPart = missingUnionMember(resolvedObjectType, expression.property, env);
          if (missingPart && expression.loc) this.diagnostics.push({
            line: expression.loc.line,
            column: expression.loc.column,
            length: expression.property.length,
            message: `Property '${expression.property}' does not exist on type '${printType(objectType)}'.
  Property '${expression.property}' does not exist on type '${printType(missingPart)}'.`
          });
        }
        return;
      }
      case "Call": {
        this.walkExpression(expression.callee, env, thisType);
        if (expression.callee.kind === "Identifier" && expression.callee.name === "Promise") {
          if (expression.args.length !== 1) this.addDiagnostic(expressionStart(expression.args[1] ?? expression.callee), "Promise() accepts exactly one executor callback.");
          const executor = expression.args[0];
          if (executor?.kind === "Function" && executor.params.length > 1) this.addDiagnostic(executor.params[1].loc, "The Promise executor receives only one resolve callback.");
        }
        if (expression.callee.kind === "Member" && expression.callee.property === "then" && expression.args.length !== 1) {
          this.addDiagnostic(expressionStart(expression.args[1] ?? expression.callee), "Promise.then() accepts exactly one fulfilled callback.");
        }
        const calleeType = resolveType(inferExpression(expression.callee, env), env);
        const directCallable = callableType(calleeType, env);
        const directFunction = expression.callee.kind === "Identifier" ? env.get(expression.callee.name) : genericFunctionExpression(expression.callee, env);
        const genericArguments = directFunction?.kind === "fun" && directFunction.generics?.length ? functionGenericArguments(directFunction, expression, env) : void 0;
        if (directFunction?.kind === "fun" && genericArguments) {
          directFunction.generics.forEach((_name, index) => {
            const constraint = directFunction.genericConstraints?.[index];
            const argument = genericArguments[index];
            if (constraint && argument && !isAssignableTo(constraint, argument, env)) {
              const loc = expression.typeArguments?.[index]?.loc ?? expressionStart(expression.args[index] ?? expression.callee);
              this.addDiagnostic(loc, `Type '${printType(argument)}' does not satisfy constraint '${printType(constraint)}'.`);
            }
          });
          if (expression.callee.kind === "Identifier" && expression.callee.loc) {
            const hover = this.hovers.find((item) => item.line === expression.callee.loc?.line && item.column === expression.callee.loc?.column);
            if (hover) hover.code += `
(infer) ${printGenericInference(directFunction.generics, genericArguments)}
(infer) return ${printType(inferExpression(expression, env))}`;
          }
        }
        const directType = expression.callee.kind === "Identifier" ? env.get(expression.callee.name) : void 0;
        if (directType?.kind === "var" && directType.keyConstraint) {
          for (const argument of expression.args) {
            const argumentType = inferGenericExpression(argument.kind === "Spread" ? argument.value : argument, env);
            if (!isAssignableTo(directType.keyConstraint, argumentType, env)) {
              const loc = expressionStart(argument);
              if (loc) this.diagnostics.push({
                line: loc.line,
                column: loc.column,
                length: argument.kind === "Literal" && typeof argument.value === "string" ? argument.value.length + 2 : 1,
                message: `Type '${printType(argumentType)}' does not satisfy constraint '${printType(directType.keyConstraint)}'.`
              });
            }
          }
        }
        if (directType?.kind === "type" && directType.generics.length) {
          const inferredType = inferExpression(expression, env);
          const typeArguments = inferredType.kind === "GenericType" ? inferredType.args : [];
          directType.generics.forEach((_name, index) => {
            const constraint = directType.genericConstraints?.[index];
            const argument = typeArguments[index];
            if (constraint && argument && !isAssignableTo(constraint, argument, env)) this.addDiagnostic(expression.typeArguments?.[index]?.loc ?? expressionStart(expression.args[0] ?? expression.callee), `Type '${printType(argument)}' does not satisfy constraint '${printType(constraint)}'.`);
          });
          if (expression.callee.loc) {
            const hover = this.hovers.find((item) => item.line === expression.callee.loc?.line && item.column === expression.callee.loc?.column);
            if (hover) hover.code += `
(infer) ${printGenericInference(directType.generics, typeArguments)}
(infer) return ${printType(inferredType)}`;
          }
        }
        if (directType?.kind === "constructor" && directType.generics.length && expression.callee.kind === "Identifier") {
          const inferredType = inferExpression(expression, env);
          const typeArguments = inferredType.kind === "GenericType" ? inferredType.args : [];
          const hover = expression.callee.loc ? this.hovers.find((item) => item.line === expression.callee.loc?.line && item.column === expression.callee.loc?.column) : void 0;
          if (hover) hover.code += `
(infer) ${printGenericInference(directType.generics, typeArguments)}
(infer) return ${printType(inferredType)}`;
        }
        if (isNullable(calleeType, env) && !(expression.callee.kind === "Member" && expression.callee.optional)) {
          this.addDiagnostic(expressionStart(expression.callee), "Cannot call a nullable value; use ! or ?? to handle null.");
        }
        if (calleeType.kind === "UnionType") {
          const optionalCall = expression.callee.kind === "Member" && expression.callee.optional;
          const nonCallable = calleeType.types.find((part) => {
            const resolved = resolveType(part, env);
            if (optionalCall && isNamedType(resolved, "null")) return false;
            return !isNamedType(resolved, "any") && !callableType(resolved, env);
          });
          if (nonCallable) {
            let loc = expressionStart(expression.callee);
            let length = 1;
            if (expression.callee.kind === "Index" && expression.callee.loc) {
              const objectLoc = expressionStart(expression.callee.object) ?? expression.callee.loc;
              loc = objectLoc;
              const indexLoc = expressionStart(expression.callee.index) ?? expression.callee.loc;
              const indexLength = expression.callee.index.kind === "Literal" ? String(expression.callee.index.value).length : 1;
              length = Math.max(1, indexLoc.column + indexLength + 1 - objectLoc.column);
            }
            if (loc) this.diagnostics.push({
              line: loc.line,
              column: loc.column,
              length,
              message: `This expression is not callable.
  Not all constituents of type '${printType(calleeType)}' are callable.
    Type '${printType(nonCallable)}' has no call signatures.`
            });
          }
        }
        const constructorMethod = constructorMethodForCall(expression.callee, expression.args, env, expression.typeArguments);
        constructorMethod?.constraints.forEach((constraint, index) => {
          const argument = constructorMethod.typeArguments[index];
          if (constraint && argument && !isAssignableTo(constraint, argument, env)) {
            this.addDiagnostic(expression.typeArguments?.[index]?.loc ?? expressionStart(expression.callee), `Type '${printType(argument)}' does not satisfy constraint '${printType(constraint)}'.`);
          }
        });
        const genericMember = expression.callee.kind === "Member" ? lookupMember(inferExpression(expression.callee.object, env), expression.callee.property, env) : void 0;
        const genericMemberArguments = isFunctionSymbol(genericMember) && genericMember.generics?.length ? functionGenericArguments({ kind: "fun", generics: genericMember.generics, genericConstraints: genericMember.genericConstraints, genericDefaults: genericMember.genericDefaults, params: genericMember.params, returnType: genericMember.returnType }, expression, env) : void 0;
        if (isFunctionSymbol(genericMember) && genericMemberArguments) genericMember.generics.forEach((_name, index) => {
          const constraint = genericMember.genericConstraints?.[index];
          const argument = genericMemberArguments[index];
          if (constraint && argument && !isAssignableTo(constraint, argument, env)) this.addDiagnostic(expression.typeArguments?.[index]?.loc ?? expressionStart(expression.callee), `Type '${printType(argument)}' does not satisfy constraint '${printType(constraint)}'.`);
        });
        if (expression.callee.kind === "Member" && expression.callee.loc) {
          const hover = this.hovers.find((item) => item.line === expression.callee.loc?.line && item.column === expression.callee.loc?.column && item.code.startsWith("(method)"));
          if (hover) {
            const inference = constructorMethod ? printGenericInference(constructorMethod.generics, constructorMethod.typeArguments) : isFunctionSymbol(genericMember) && genericMemberArguments ? printGenericInference(genericMember.generics, genericMemberArguments) : void 0;
            if (inference) hover.code += `
(infer) ${inference}`;
            hover.code += `
(infer) return ${printType(inferExpression(expression, env))}`;
          }
        }
        const genericFunctionParameters = directFunction?.kind === "fun" && genericArguments ? directFunction.params.map((param) => ({ ...param, type: param.type ? instantiate(param.type, directFunction.generics, genericArguments) : void 0 })) : void 0;
        const genericMemberParameters = isFunctionSymbol(genericMember) && genericMemberArguments ? genericMember.params.map((param) => ({ ...param, type: param.type ? instantiate(param.type, genericMember.generics, genericMemberArguments) : void 0 })) : void 0;
        const methodParameters = genericFunctionParameters ?? constructorMethod?.params ?? genericMemberParameters ?? (expression.callee.kind === "Member" ? (() => {
          const member = lookupMember(inferExpression(expression.callee.object, env), expression.callee.property, env);
          return isFunctionSymbol(member) ? member.params : void 0;
        })() : void 0);
        expression.args.forEach((arg, index) => {
          const contextualType = methodParameters?.[index] ? parameterType(methodParameters[index]) : directCallable?.params[index];
          if (arg.kind === "Function") this.walkFunction(arg, env, contextualType);
          else this.walkExpression(arg, env, thisType);
        });
        expression.typeArguments?.forEach((type) => this.walkType(type, env));
        if (expression.callee.kind === "Member" && expression.callee.property === "as" && expression.typeArguments?.length) {
          const target = expression.typeArguments[0];
          if (target.loc) {
            const hover = this.hovers.find((item) => item.line === target.loc?.line && item.column === target.loc?.column);
            if (hover && !hover.code.includes("(infer)")) hover.code += `
(infer) ${printType(inferExpression(expression, env))}`;
          }
        }
        this.addParameterHints(expression.callee, expression.args, env);
        return;
      }
      case "Function":
        this.walkFunction(expression, env);
        return;
      case "Conditional":
        this.walkExpression(expression.condition, env, thisType);
        this.walkExpression(expression.consequent, env, thisType);
        this.walkExpression(expression.alternate, env, thisType);
        return;
      case "Match":
        this.walkExpression(expression.value, env, thisType);
        for (const item of expression.cases) {
          const local = matchCaseEnv(expression, item.pattern, env);
          if (item.guard) this.walkExpression(item.guard, local, thisType);
          this.statements(item.body, local);
          for (const [name, symbol] of local) if (!env.has(name) && symbol.kind === "var") {
            const property = item.pattern?.kind === "PatternObject" ? item.pattern.properties.find((candidate) => candidate.name === name) : void 0;
            this.addHover(name, property?.loc, `const ${name}: ${printType(symbol.type)}`, void 0, typeDescription(symbol.type, local));
          }
        }
        return;
      case "Try":
        if (expression.body) this.statements(expression.body, new Map(env));
        else this.walkExpression(expression.value, env, thisType);
        const trySource = resolveType(expression.body ? inferFunctionReturnType2(expression.body, env) : inferExpression(expression.value, env), env);
        const tryParts = (trySource.kind === "UnionType" ? trySource.types : [trySource]).map((part) => resolveType(part, env));
        const errorTypes = tryParts.flatMap((part) => part.kind === "ObjectType" ? part.members.filter((member) => member.name === "error").map((member) => member.type) : []);
        const inferredError = errorTypes.length ? unionOf(errorTypes) : named("Error");
        for (const clause of expression.catches) {
          const local = new Map(env);
          if (clause.binding) {
            const type = clause.type ?? inferredError;
            local.set(clause.binding, { kind: "var", mutable: false, type });
            this.addHover(clause.binding, clause.bindingLoc, `const ${clause.binding}: ${printType(type)}`);
          }
          if (clause.type) this.walkType(clause.type, env);
          this.statements(clause.body, local);
        }
        if (expression.finallyBody) this.statements(expression.finallyBody, new Map(env));
        this.addHover("try", expression.loc, `(try expression) ${printType(inferExpression(expression, env))}`);
        return;
      case "Is":
        this.walkExpression(expression.value, env, thisType);
        this.walkType(expression.type, env);
        return;
    }
  }
  walkFunction(expression, env, contextualType) {
    const genericEnv = new Map(env);
    (expression.generics ?? []).forEach((name, index) => {
      const constraint = expression.genericConstraints?.[index];
      const defaultType = expression.genericDefaults?.[index];
      genericEnv.set(name, { kind: "type", generics: [], value: constraint ?? defaultType ?? named("any"), typeParameter: true });
      this.addHover(name, expression.genericLocs?.[index], `(type parameter) ${name}${constraint ? ` is ${printType(constraint)}` : ""}${defaultType ? ` = ${printType(defaultType)}` : ""}`);
      if (constraint) this.walkType(constraint, env);
      if (defaultType) {
        this.walkType(defaultType, env);
        if (constraint && !isAssignableTo(constraint, defaultType, env)) this.addDiagnostic(expression.genericLocs?.[index], `Default type '${printType(defaultType)}' does not satisfy constraint '${printType(constraint)}'.`);
      }
    });
    const local = bindInferredParameters(expression.params, genericEnv);
    const contextual = contextualType ? removeNull(resolveType(contextualType, env)) : void 0;
    if (contextual?.kind === "FunctionType") expression.params.forEach((param, index) => {
      const type = contextual.params[index] ?? (contextual.rest?.kind === "ArrayType" ? contextual.rest.element : void 0);
      if (!param.type && type) local.set(param.name, { kind: "var", mutable: true, type });
    });
    for (const [index, param] of expression.params.entries()) {
      const contextualParameter = contextual?.kind === "FunctionType" ? contextual.params[index] : void 0;
      const type = param.type ?? contextualParameter ?? local.get(param.name).type;
      if (!param.type && param.defaultValue !== void 0) {
        const index2 = expression.params.indexOf(param);
        expression.params[index2] = { ...param, type };
      }
      this.addHover(param.name, param.loc, param.name === "_" ? `(ignored parameter) _: ${printType(type)}` : parameterHover(param, type));
      if (param.name !== "_") this.addTypeHint(param.loc, param.name, Boolean(param.type), type, "callbackType");
      if (param.type) this.walkType(param.type, local);
      if (param.defaultValue) this.walkExpression(param.defaultValue, local);
    }
    if (expression.returnType) this.walkType(expression.returnType, local);
    if (expression.expressionBody) this.walkExpression(expression.expressionBody, local);
    else this.statements(expression.body, local);
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
    case "RegEx":
    case "Literal":
    case "Identifier":
    case "Array":
    case "Object":
    case "Unary":
      return expression.loc;
    case "MemberAssignment":
      return expression.loc ?? expressionStart(expression.object);
    case "Template":
      return expression.loc;
    case "Conditional":
      return expressionStart(expression.condition);
    case "Binary":
      return expressionStart(expression.left);
    case "Member":
      return expressionStart(expression.object);
    case "Index":
      return expressionStart(expression.object);
    case "Call":
      return expressionStart(expression.callee);
    case "Function":
      return expression.loc ?? expression.params[0]?.loc;
  }
}
function expressionReference(expression) {
  if (expression.kind === "Identifier") return expression.name;
  if (expression.kind === "Member") return `${expressionReference(expression.object)}${expression.optional ? "?." : "."}${expression.property}`;
  if (expression.kind === "Index") {
    const index = expression.index.kind === "Identifier" ? expression.index.name : expression.index.kind === "Literal" ? JSON.stringify(expression.index.value) : "\u2026";
    return `${expressionReference(expression.object)}[${index}]`;
  }
  return "object";
}
function parseForAnalysis(source, filePath) {
  const lines = source.split(/\r?\n/);
  const recoverable = [...lines];
  const diagnostics = [];
  const masked = /* @__PURE__ */ new Set();
  for (let attempt = 0; attempt <= lines.length; attempt++) {
    try {
      return { statements: parse(recoverable.join("\n"), { validate: false, filePath }), diagnostics };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const location = /\bat (\d+):(\d+)\s*$/.exec(message);
      if (!location) return { statements: [], diagnostics: [...diagnostics, { line: 1, column: 1, length: 1, message }] };
      const line = Math.max(1, Math.min(lines.length, Number(location[1])));
      const column = Math.max(1, Number(location[2]));
      if (masked.has(line)) return { statements: [], diagnostics };
      masked.add(line);
      diagnostics.push({
        line,
        column,
        length: Math.max(1, (lines[line - 1]?.length ?? column) - column + 1),
        message: message.replace(/\s+at \d+:\d+\s*$/, "")
      });
      const indentation = recoverable[line - 1]?.match(/^\s*/)?.[0] ?? "";
      if (recoverable[line - 1]?.trim()) recoverable[line - 1] = indentation;
      else {
        const next = recoverable.slice(line).find((candidate) => candidate.trim());
        recoverable[line - 1] = `${next?.match(/^\s*/)?.[0] ?? indentation}null`;
      }
    }
  }
  return { statements: [], diagnostics };
}
function analyze(source, filePath) {
  try {
    const analyzer = new Analyzer();
    const recovered = parseForAnalysis(source, filePath);
    const statements = recovered.statements;
    const imported = importedDeclarations(statements, filePath);
    const stringifyForTypeSearch = (value) => JSON.stringify(value, (_key, item) => typeof item === "bigint" ? `${item}n` : item);
    const needsIterable = stringifyForTypeSearch(statements).includes("Iterable") || stringifyForTypeSearch([...imported]).includes("Iterable");
    if (needsIterable) {
      const fs2 = require("node:fs");
      const path2 = require("node:path");
      let directory = path2.dirname(path2.resolve(filePath ?? process.cwd()));
      let iterablePath;
      while (true) {
        const candidate = path2.join(directory, "types", "iterable.jn");
        if (fs2.existsSync(candidate)) {
          iterablePath = candidate;
          break;
        }
        const parent = path2.dirname(directory);
        if (parent === directory) break;
        directory = parent;
      }
      iterablePath ??= path2.resolve(__dirname, "../../types/iterable.jn");
      if (fs2.existsSync(iterablePath)) {
        const iterableStatements = parse(fs2.readFileSync(iterablePath, "utf8"), { validate: false, filePath: iterablePath });
        const iterable2 = importedDeclarations(iterableStatements).get("Iterable");
        if (iterable2?.kind === "type") imported.set("Iterable", iterable2);
      }
    }
    for (const item of statements) {
      const statement = item.kind === "Export" ? item.declaration : item;
      if (statement.kind !== "Import") continue;
      const selected = [...imported].filter(([name, symbol]) => statement.namedImports.includes(name) || statement.module === "juno:node:fs" && (name === "FileStat" || statement.defaultImport && symbol.kind === "fun"));
      statement.importedTypes = Object.fromEntries(selected.flatMap(([name, symbol]) => symbol.kind === "type" ? [[name, symbol.value]] : []));
      statement.importedSymbols = Object.fromEntries(selected);
    }
    const builtins = /* @__PURE__ */ new Map();
    const iterable = imported.get("Iterable");
    if (iterable?.kind === "type" && !statements.some((statement) => statement.kind === "TypeDeclaration" && statement.name === "Iterable")) builtins.set("Iterable", iterable);
    analyzer.analyze(statements, builtins);
    return { hovers: analyzer.hovers, hints: analyzer.hints, diagnostics: [...recovered.diagnostics, ...analyzer.diagnostics], semanticTokens: analyzer.semanticTokens };
  } catch (error) {
    return void 0;
  }
}
function hoverAt(source, line, column, filePath) {
  const result = analyze(source, filePath);
  if (!result) return void 0;
  const matches = result.hovers.filter((item) => item.line === line && column >= item.column && column <= item.column + item.length);
  return matches.sort((a, b) => a.length - b.length)[0];
}
function inlayHintsFor(source, filePath) {
  return analyze(source, filePath)?.hints ?? [];
}
function exportsForFile(filePath) {
  try {
    const fs2 = require("node:fs");
    const source = fs2.readFileSync(filePath, "utf8");
    const declarations = /\.jn$/i.test(filePath) ? importedDeclarations(parse(source, { validate: false, filePath }), filePath) : hostDeclarations(source);
    return [...declarations].map(([name, symbol]) => ({
      name,
      detail: printSymbol(name, symbol).code
    })).sort((left, right) => left.name.localeCompare(right.name));
  } catch {
    return [];
  }
}

// src/extension.ts
function moduleSpecifier(documentFile, exportedFile) {
  let relative2 = path.relative(path.dirname(documentFile), exportedFile).replace(/\\/g, "/");
  relative2 = relative2.replace(/\.(?:jn|[cm]?[jt]s)$/i, "").replace(/\/index$/i, "");
  return relative2.startsWith(".") ? relative2 : `./${relative2}`;
}
async function importCandidates(document, name) {
  const candidates = [];
  const seen = /* @__PURE__ */ new Set();
  const seenFiles = /* @__PURE__ */ new Set();
  const addFile = (module2, file) => {
    const resolvedFile = path.resolve(file);
    if (seen.has(module2) || seenFiles.has(resolvedFile) || resolvedFile === path.resolve(document.uri.fsPath)) return;
    const exported = exportsForFile(file).find((symbol) => symbol.name === name);
    if (!exported) return;
    seen.add(module2);
    seenFiles.add(resolvedFile);
    candidates.push({ module: module2 });
  };
  const standardModules = {
    juno: ["console", "Math", "types", "Error", "Range", "Iterable", "Boolean", "Number", "String"],
    "juno:node": ["console"],
    "juno:node:fs": ["FileStat", ...["readFile", "writeFile", "appendFile", "exists", "mkdir", "readdir", "remove", "rename", "copyFile", "stat"].flatMap((name2) => [name2, `${name2}Sync`])],
    "juno:async": ["Promise", "RejectedResult", "TimerHandle", "ImmediateHandle", "AsyncCallback", "FetchInput", "FetchOptions", "FetchResponse", "setTimeout", "setInterval", "clearTimeout", "clearInterval", "setImmediate", "clearImmediate", "queueMicrotask", "fetch"],
    "juno:types": ["Iterable", "Range", "Array", "Set", "ValueSet", "Map", "ValueMap", "Queue", "Object", "Boolean", "Tuple", "Random", "Error", "Result", "ok", "Partial", "Required", "Readonly", "Pick", "Omit", "KeyOf", "Exclude", "Items"]
  };
  for (const [module2, exports2] of Object.entries(standardModules)) if (exports2.includes(name)) {
    seen.add(module2);
    candidates.push({ module: module2 });
  }
  const projectRoot = path.resolve(__dirname, "../..");
  seenFiles.add(path.join(projectRoot, "Modules", "juno.ts"));
  seenFiles.add(path.join(projectRoot, "Modules", "juno-node.ts"));
  seenFiles.add(path.join(projectRoot, "Modules", "juno-node-fs.ts"));
  seenFiles.add(path.join(projectRoot, "types", "index.jn"));
  const files = await vscode.workspace.findFiles(
    "**/*.{jn,ts,js,mts,cts,mjs,cjs}",
    "**/{node_modules,dist,out,.git,.build-tools}/**",
    1e3
  );
  for (const uri of files) addFile(moduleSpecifier(document.uri.fsPath, uri.fsPath), uri.fsPath);
  return candidates;
}
function addImportEdit(document, name, module2) {
  const edit = new vscode.WorkspaceEdit();
  const source = document.getText();
  const escapedModule = module2.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const existing = new RegExp(`(?:export\\s+)?import\\s*\\{([\\s\\S]*?)\\}\\s*from\\s*(['"])${escapedModule}\\2`).exec(source);
  if (existing) {
    const brace = source.indexOf("}", existing.index);
    const names = existing[1].split(",").map((item) => item.trim()).filter(Boolean);
    const prefix = names.length ? `${existing[1].trimEnd().endsWith(",") ? "" : ","} ` : "";
    edit.insert(document.uri, document.positionAt(brace), `${prefix}${name}`);
    return edit;
  }
  edit.insert(document.uri, new vscode.Position(0, 0), `import { ${name} } from '${module2}'
`);
  return edit;
}
function resolveImportedFile(documentFile, specifier) {
  if (!specifier.startsWith(".")) return void 0;
  const base = path.resolve(path.dirname(documentFile), specifier);
  const candidates = /\.(?:jn|[cm]?[jt]s)$/i.test(base) ? [base] : [
    `${base}.jn`,
    `${base}.ts`,
    `${base}.js`,
    path.join(base, "index.jn"),
    path.join(base, "index.ts"),
    path.join(base, "index.js")
  ];
  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
}
function importCompletions(document, position) {
  const line = document.lineAt(position.line).text;
  const before = line.slice(0, position.character);
  const named2 = /^\s*(?:export\s+)?import\s*\{([^}]*)$/.exec(before);
  if (named2) {
    const tail = line.slice(position.character);
    const module2 = /^\s*\}\s*from\s*['"]([^'"]+)['"]/.exec(tail)?.[1];
    if (!module2) return [];
    const file = resolveImportedFile(document.uri.fsPath, module2);
    if (!file) return [];
    const typed2 = named2[1].split(",").pop()?.trim() ?? "";
    const imported = new Set(named2[1].split(",").slice(0, -1).map((name) => name.trim()));
    const start2 = new vscode.Position(position.line, position.character - typed2.length);
    return exportsForFile(file).filter((symbol) => !imported.has(symbol.name) && symbol.name.startsWith(typed2)).map((symbol) => {
      const item = new vscode.CompletionItem(symbol.name, vscode.CompletionItemKind.Reference);
      item.detail = symbol.detail;
      item.documentation = `Export from ${module2}`;
      item.range = new vscode.Range(start2, position);
      return item;
    });
  }
  const moduleMatch = /\bfrom\s+(['"])([^'"]*)$/.exec(before);
  if (!moduleMatch) return void 0;
  const typed = moduleMatch[2];
  const start = new vscode.Position(position.line, position.character - typed.length);
  const modules = /* @__PURE__ */ new Set(["juno", "juno:node", "juno:node:fs", "juno:types", "juno:async", "types"]);
  if (typed.startsWith(".")) {
    const slash = Math.max(typed.lastIndexOf("/"), typed.lastIndexOf("\\"));
    const directoryPart = slash < 0 ? "." : typed.slice(0, slash + 1);
    const namePart = slash < 0 ? typed.slice(2) : typed.slice(slash + 1);
    const directory = path.resolve(path.dirname(document.uri.fsPath), directoryPart);
    try {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (!entry.name.startsWith(namePart) || entry.name.startsWith(".")) continue;
        const normalizedDirectory = directoryPart.replace(/\\/g, "/");
        const baseName = entry.isDirectory() ? `${entry.name}/` : entry.name.replace(/\.(?:jn|[cm]?[jt]s)$/i, "");
        modules.add(`${normalizedDirectory}${baseName}`);
      }
    } catch {
    }
  }
  return [...modules].filter((name) => name.startsWith(typed)).map((name) => {
    const item = new vscode.CompletionItem(name, name.endsWith("/") ? vscode.CompletionItemKind.Folder : vscode.CompletionItemKind.Module);
    item.range = new vscode.Range(start, position);
    return item;
  });
}
function activate(context) {
  const selector = { language: "junoscript", scheme: "file" };
  const diagnostics = vscode.languages.createDiagnosticCollection("junoscript");
  const semanticLegend = new vscode.SemanticTokensLegend(["method"]);
  const updateDiagnostics = (document) => {
    if (document.languageId !== "junoscript") return;
    const result = analyze(document.getText(), document.uri.fsPath);
    diagnostics.set(document.uri, (result?.diagnostics ?? []).map((info) => {
      const start = new vscode.Position(info.line - 1, info.column - 1);
      const end = new vscode.Position(info.line - 1, info.column - 1 + info.length);
      return new vscode.Diagnostic(new vscode.Range(start, end), info.message, vscode.DiagnosticSeverity.Error);
    }));
  };
  const keywordHover = vscode.languages.registerHoverProvider(selector, {
    provideHover(document, position) {
      const range = document.getWordRangeAtPosition(position, /\b(?:export|import)\b/);
      if (!range) return;
      const word = document.getText(range);
      const markdown = new vscode.MarkdownString();
      markdown.appendCodeblock(word === "export" ? "export const | fun | type" : "import { name } from 'module'", "junoscript");
      markdown.appendMarkdown(word === "export" ? "Exports this declaration from the current Juno module." : "Imports exported bindings from a Juno module.");
      return new vscode.Hover(markdown, range);
    }
  });
  vscode.workspace.textDocuments.forEach(updateDiagnostics);
  context.subscriptions.push(
    diagnostics,
    keywordHover,
    vscode.workspace.onDidOpenTextDocument(updateDiagnostics),
    vscode.workspace.onDidChangeTextDocument((event) => updateDiagnostics(event.document)),
    vscode.workspace.onDidCloseTextDocument((document) => diagnostics.delete(document.uri)),
    vscode.languages.registerHoverProvider(selector, {
      provideHover(document, position) {
        const info = hoverAt(document.getText(), position.line + 1, position.character + 1, document.uri.fsPath);
        if (!info) return;
        const markdown = new vscode.MarkdownString();
        markdown.appendCodeblock(info.code, "junoscript");
        if (info.docs) markdown.appendMarkdown(`
${info.docs}`);
        if (info.typeDescription) {
          markdown.appendMarkdown("\n\nType description:");
          markdown.appendCodeblock(info.typeDescription, "typescript");
        }
        const range = new vscode.Range(info.line - 1, info.column - 1, info.line - 1, info.column - 1 + info.length);
        return new vscode.Hover(markdown, range);
      }
    }),
    vscode.languages.registerDocumentSemanticTokensProvider(selector, {
      provideDocumentSemanticTokens(document) {
        const builder = new vscode.SemanticTokensBuilder(semanticLegend);
        const result = analyze(document.getText(), document.uri.fsPath);
        for (const token of result?.semanticTokens ?? []) {
          builder.push(token.line - 1, token.column - 1, token.length, 0, 0);
        }
        return builder.build();
      }
    }, semanticLegend),
    vscode.languages.registerInlayHintsProvider(selector, {
      provideInlayHints(document) {
        const config = vscode.workspace.getConfiguration("junoscript.inlayHints");
        const variableTypes = config.get("variableTypes.enabled", true);
        const parameterNames = config.get("parameterNames.enabled", true);
        return inlayHintsFor(document.getText(), document.uri.fsPath).flatMap((hint) => {
          if (hint.kind === "type" && !variableTypes) return [];
          if (hint.kind === "parameter" && !parameterNames) return [];
          const position = new vscode.Position(hint.line - 1, hint.column - 1);
          const item = new vscode.InlayHint(
            position,
            hint.label,
            hint.kind === "parameter" ? vscode.InlayHintKind.Parameter : vscode.InlayHintKind.Type
          );
          item.tooltip = new vscode.MarkdownString();
          item.tooltip.appendCodeblock(hint.tooltip, "junoscript");
          item.paddingLeft = hint.kind !== "parameter";
          item.paddingRight = hint.kind === "parameter";
          return [item];
        });
      }
    }),
    vscode.languages.registerCompletionItemProvider(selector, {
      provideCompletionItems(document, position) {
        const imports = importCompletions(document, position);
        if (imports) return imports;
        const linePrefix = document.lineAt(position.line).text.slice(0, position.character);
        const match = /([A-Za-z_$][\w$]*)\s*\[\s*(?:(['"])([^'"]*)?)?$/.exec(linePrefix);
        if (!match) return [];
        const objectName = match[1];
        const quote = match[2];
        const typed = match[3] ?? "";
        const objectColumn = (match.index ?? 0) + match[0].indexOf(objectName);
        let info = hoverAt(document.getText(), position.line + 1, objectColumn + 1, document.uri.fsPath);
        if (!info?.typeDescription) {
          const line = document.lineAt(position.line).text;
          const before = line.slice(0, match.index) + objectName;
          const after = line.slice(position.character).replace(/^['"]?\s*\]/, "");
          const lines = document.getText().split(/\r?\n/);
          lines[position.line] = before + after;
          info = hoverAt(lines.join("\n"), position.line + 1, objectColumn + 1, document.uri.fsPath);
        }
        if (!info?.typeDescription) return [];
        const fields = /* @__PURE__ */ new Map();
        const fieldPattern = /^\s*(?:(?:readonly|sealed)\s+)*(?:"([^"]+)"|(-?\d+(?:\.\d+)?)|([A-Za-z_$][\w$]*))\??\s*(?::|\()/gm;
        for (let field2 = fieldPattern.exec(info.typeDescription); field2; field2 = fieldPattern.exec(info.typeDescription)) {
          const name = field2[1] ?? field2[2] ?? field2[3];
          if (name.startsWith("__") || fields.has(name)) continue;
          fields.set(name, field2[0].trim());
        }
        const replaceStart = new vscode.Position(position.line, position.character - typed.length);
        const range = new vscode.Range(replaceStart, position);
        return [...fields].filter(([name]) => name.startsWith(typed)).map(([name, detail]) => {
          const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Field);
          item.detail = detail;
          item.insertText = quote ? name : `'${name}'`;
          item.range = range;
          return item;
        });
      }
    }, "[", "{", ",", "'", '"', "/"),
    vscode.languages.registerCodeActionsProvider(selector, {
      async provideCodeActions(document, _range, context2) {
        const result = analyze(document.getText(), document.uri.fsPath);
        if (!result) return [];
        const actions = [];
        for (const diagnostic of context2.diagnostics) {
          const info = result.diagnostics.find((item) => item.fix && item.line === diagnostic.range.start.line + 1 && item.message === diagnostic.message);
          if (info?.fix) {
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
          const missingName = /^Cannot find name '([^']+)'\.$/.exec(diagnostic.message)?.[1];
          if (!missingName) continue;
          const candidates = await importCandidates(document, missingName);
          for (const [index, candidate] of candidates.entries()) {
            const action = new vscode.CodeAction(`Import '${missingName}' from '${candidate.module}'`, vscode.CodeActionKind.QuickFix);
            action.diagnostics = [diagnostic];
            action.isPreferred = index === 0;
            action.edit = addImportEdit(document, missingName, candidate.module);
            actions.push(action);
          }
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
